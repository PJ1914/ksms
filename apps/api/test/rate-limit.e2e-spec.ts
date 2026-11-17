import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createPrismaMock, createTestApp } from './test-app';

describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  const original = process.env.THROTTLE_LIMIT;

  beforeAll(async () => {
    process.env.THROTTLE_LIMIT = '3';
    app = await createTestApp(createPrismaMock());
  });
  afterAll(async () => {
    process.env.THROTTLE_LIMIT = original;
    await app.close();
  });

  it('allows requests up to the limit, then answers 429 RATE_LIMITED in the standard format', async () => {
    for (let i = 0; i < 3; i++)
      await request(app.getHttpServer()).get('/api/v1/test/ping').expect(200);
    const res = await request(app.getHttpServer()).get('/api/v1/test/ping').expect(429);
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });

  it('never rate limits health probes', async () => {
    for (let i = 0; i < 10; i++)
      await request(app.getHttpServer()).get('/api/v1/health').expect(200);
  });
});
