import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { API_PREFIX } from '@ksms/constants';
import { HealthModule } from '../src/modules/health/health.module';
import { PrismaService } from '../src/database/prisma.service';

describe('Health (e2e, database mocked)', () => {
  let app: INestApplication;
  const prisma = { $queryRaw: jest.fn() };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [HealthModule] })
      .useMocker((token) => (token === PrismaService ? prisma : undefined))
      .compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health is live without touching the database', async () => {
    prisma.$queryRaw.mockClear();
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toEqual({ data: { status: 'ok' } });
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });

  it('GET /health/ready is ok when the database answers', async () => {
    prisma.$queryRaw.mockResolvedValueOnce([{ '?column?': 1 }]);
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body.data.database).toBe('up');
  });

  it('GET /health/ready returns 503 when the database is down', async () => {
    prisma.$queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(503);
    expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
  });
});
