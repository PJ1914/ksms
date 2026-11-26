import { Controller, Get, INestApplication, Req } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import request from 'supertest';
import { parseEnv } from '../config/env';
import { applyTrustProxy } from './configure-app';

@Controller()
class IpController {
  @Get('ip')
  ip(@Req() req: Request) {
    return { ip: req.ip };
  }
}

const env = (over: Record<string, string>) =>
  parseEnv({ DATABASE_URL: 'postgresql://u:p@h/d', JWT_ACCESS_SECRET: 'x'.repeat(32), ...over });

async function appWith(over: Record<string, string>): Promise<INestApplication> {
  const ref = await Test.createTestingModule({ controllers: [IpController] }).compile();
  const app = ref.createNestApplication<NestExpressApplication>({ logger: false });
  applyTrustProxy(app, env(over));
  await app.init();
  return app;
}

describe('client IP behind the proxy (FIXES F17)', () => {
  it('in production trusts exactly one hop: the address Render appended, not one the client sent', async () => {
    const app = await appWith({ NODE_ENV: 'production' });
    try {
      // The client sent "6.6.6.6"; Render's proxy appended the real address 203.0.113.7.
      const res = await request(app.getHttpServer())
        .get('/ip')
        .set('X-Forwarded-For', '6.6.6.6, 203.0.113.7');
      expect(res.body.ip).toBe('203.0.113.7');
    } finally {
      await app.close();
    }
  });

  it('two distinct clients get distinct IPs', async () => {
    const app = await appWith({ NODE_ENV: 'production' });
    try {
      const a = await request(app.getHttpServer())
        .get('/ip')
        .set('X-Forwarded-For', '198.51.100.1');
      const b = await request(app.getHttpServer())
        .get('/ip')
        .set('X-Forwarded-For', '198.51.100.2');
      expect(a.body.ip).not.toBe(b.body.ip);
    } finally {
      await app.close();
    }
  });

  it('outside production X-Forwarded-For is ignored entirely', async () => {
    const app = await appWith({ NODE_ENV: 'development' });
    try {
      const res = await request(app.getHttpServer()).get('/ip').set('X-Forwarded-For', '6.6.6.6');
      expect(res.body.ip).not.toBe('6.6.6.6');
    } finally {
      await app.close();
    }
  });

  it('the hop count is configurable and bounded', () => {
    expect(env({}).TRUST_PROXY_HOPS).toBe(1);
    expect(env({ TRUST_PROXY_HOPS: '2' }).TRUST_PROXY_HOPS).toBe(2);
    expect(() => env({ TRUST_PROXY_HOPS: '9' })).toThrow(/TRUST_PROXY_HOPS/);
  });
});
