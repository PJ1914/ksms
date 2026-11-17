import { INestApplication } from '@nestjs/common';
import { SignJWT } from 'jose';
import request from 'supertest';
import { AccessTokenService } from '../src/common/auth/access-token.service';
import { PrismaMock, createPrismaMock, createTestApp, ids } from './test-app';

const claims = { sub: ids.user, sid: ids.session, org: ids.org, v: 0 };
const okSession = () => ({
  userId: ids.user,
  organizationId: ids.org,
  revokedAt: null,
  expiresAt: new Date(Date.now() + 3_600_000),
  user: { isActive: true, tokenVersion: 0 },
});
const okMember = (branchIds: string[] = [ids.branch]) => ({
  id: ids.member,
  roleId: ids.role,
  status: 'ACTIVE',
  branches: branchIds.map((branchId) => ({ branchId })),
});

describe('API foundation (e2e, database mocked)', () => {
  let app: INestApplication;
  let prisma: PrismaMock;
  let tokens: AccessTokenService;
  let http: () => ReturnType<typeof request>;
  const secret = () => new TextEncoder().encode(process.env.JWT_ACCESS_SECRET);

  beforeAll(async () => {
    prisma = createPrismaMock();
    app = await createTestApp(prisma);
    tokens = app.get(AccessTokenService);
    http = () => request(app.getHttpServer());
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    prisma.userSession.findUnique.mockResolvedValue(okSession());
    prisma.organizationMember.findUnique.mockResolvedValue(okMember());
  });

  const bearer = async (c = claims) => `Bearer ${await tokens.sign(c)}`;

  describe('response and error format', () => {
    it('wraps success as { data } and exposes health publicly', async () => {
      prisma.$queryRaw.mockResolvedValue([{ '?column?': 1 }]);
      const live = await http().get('/api/v1/health').expect(200);
      expect(live.body).toEqual({ data: { status: 'ok' } });
      const ready = await http().get('/api/v1/health/ready').expect(200);
      expect(ready.body).toEqual({ data: { status: 'ok', database: 'up' } });
    });

    it('returns 503 DATABASE_UNAVAILABLE when the database is down', async () => {
      prisma.$queryRaw.mockRejectedValue(new Error('connection refused'));
      const res = await http().get('/api/v1/health/ready').expect(503);
      expect(res.body.error.code).toBe('DATABASE_UNAVAILABLE');
    });

    it('returns a standard 404', async () => {
      const res = await http().get('/api/v1/nope').expect(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expect(typeof res.body.error.correlationId).toBe('string');
    });

    it('hides internal details on unexpected errors (500)', async () => {
      const res = await http().get('/api/v1/test/boom').expect(500);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('secret-db-password-leak');
    });

    it('maps unique-constraint violations to 409 CONFLICT', async () => {
      const res = await http().get('/api/v1/test/duplicate').expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(JSON.stringify(res.body)).not.toContain('sku');
    });

    it('sets security headers', async () => {
      const res = await http().get('/api/v1/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('correlation ids', () => {
    it('echoes a well-formed client id in header and error body', async () => {
      const res = await http()
        .get('/api/v1/nope')
        .set('x-correlation-id', 'client-req-12345')
        .expect(404);
      expect(res.headers['x-correlation-id']).toBe('client-req-12345');
      expect(res.body.error.correlationId).toBe('client-req-12345');
    });

    it('replaces a malformed id with a generated one', async () => {
      const res = await http().get('/api/v1/nope').set('x-correlation-id', 'bad id <script>');
      expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  describe('validation', () => {
    it('accepts a valid body', async () => {
      const res = await http().post('/api/v1/test/echo').send({ name: 'Rice', qty: 2 }).expect(201);
      expect(res.body).toEqual({ data: { name: 'Rice', qty: 2 } });
    });

    it('rejects invalid fields with field-level details', async () => {
      const res = await http().post('/api/v1/test/echo').send({ name: '', qty: 0 }).expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const fields = res.body.error.details.map((d: { field: string }) => d.field).sort();
      expect(fields).toEqual(['name', 'qty']);
    });

    it('rejects unknown properties (no mass assignment)', async () => {
      const res = await http()
        .post('/api/v1/test/echo')
        .send({ name: 'Rice', qty: 1, organizationId: ids.otherOrg })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('authentication', () => {
    it('rejects a missing token', async () => {
      const res = await http().get('/api/v1/context').expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('rejects garbage, wrong-secret, wrong-algorithm and expired tokens', async () => {
      const wrongSecret = await new SignJWT({ sid: ids.session, org: ids.org, v: 0 })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(ids.user)
        .setIssuer('ksms-api')
        .setAudience('ksms-app')
        .setExpirationTime('1h')
        .sign(new TextEncoder().encode('another-secret-another-secret-123456'));
      const wrongAlg = await new SignJWT({ sid: ids.session, org: ids.org, v: 0 })
        .setProtectedHeader({ alg: 'HS512' })
        .setSubject(ids.user)
        .setIssuer('ksms-api')
        .setAudience('ksms-app')
        .setExpirationTime('1h')
        .sign(secret());
      const expired = await new SignJWT({ sid: ids.session, org: ids.org, v: 0 })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(ids.user)
        .setIssuer('ksms-api')
        .setAudience('ksms-app')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
        .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
        .sign(secret());
      for (const t of ['garbage', wrongSecret, wrongAlg, expired]) {
        await http().get('/api/v1/context').set('Authorization', `Bearer ${t}`).expect(401);
      }
      expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
    });

    it.each([
      ['session not found', () => prisma.userSession.findUnique.mockResolvedValue(null)],
      [
        'session revoked (logout)',
        () =>
          prisma.userSession.findUnique.mockResolvedValue({
            ...okSession(),
            revokedAt: new Date(),
          }),
      ],
      [
        'session expired',
        () =>
          prisma.userSession.findUnique.mockResolvedValue({
            ...okSession(),
            expiresAt: new Date(Date.now() - 1000),
          }),
      ],
      [
        'user deactivated',
        () =>
          prisma.userSession.findUnique.mockResolvedValue({
            ...okSession(),
            user: { isActive: false, tokenVersion: 0 },
          }),
      ],
      [
        'token version bumped (password change)',
        () =>
          prisma.userSession.findUnique.mockResolvedValue({
            ...okSession(),
            user: { isActive: true, tokenVersion: 1 },
          }),
      ],
      [
        'session belongs to another organization',
        () =>
          prisma.userSession.findUnique.mockResolvedValue({
            ...okSession(),
            organizationId: ids.otherOrg,
          }),
      ],
    ])('rejects a valid token when: %s', async (_name, arrange) => {
      arrange();
      const res = await http()
        .get('/api/v1/context')
        .set('Authorization', await bearer())
        .expect(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('accepts a valid token and returns the tenant context', async () => {
      const res = await http()
        .get('/api/v1/context')
        .set('Authorization', await bearer())
        .expect(200);
      expect(res.body).toEqual({
        data: { userId: ids.user, organizationId: ids.org, branchId: null, roleId: ids.role },
      });
    });
  });

  describe('tenant and branch isolation', () => {
    it('denies a user who is not an active member of the token organization', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue(null);
      const res = await http()
        .get('/api/v1/context')
        .set('Authorization', await bearer())
        .expect(403);
      expect(res.body.error.code).toBe('ORG_ACCESS_DENIED');
    });

    it('denies deactivated members', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        ...okMember(),
        status: 'DEACTIVATED',
      });
      const res = await http()
        .get('/api/v1/context')
        .set('Authorization', await bearer())
        .expect(403);
      expect(res.body.error.code).toBe('ORG_ACCESS_DENIED');
    });

    it('takes the organization only from the token, ignoring client-supplied org headers', async () => {
      await http()
        .get('/api/v1/context')
        .set('Authorization', await bearer())
        .set('x-organization-id', ids.otherOrg)
        .expect(200);
      expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId_userId: { organizationId: ids.org, userId: ids.user } },
        }),
      );
    });

    it('accepts an assigned branch', async () => {
      const res = await http()
        .get('/api/v1/context')
        .set('Authorization', await bearer())
        .set('x-branch-id', ids.branch)
        .expect(200);
      expect(res.body.data.branchId).toBe(ids.branch);
    });

    it('rejects a branch the user is not assigned to', async () => {
      const res = await http()
        .get('/api/v1/context')
        .set('Authorization', await bearer())
        .set('x-branch-id', ids.otherBranch)
        .expect(403);
      expect(res.body.error.code).toBe('BRANCH_FORBIDDEN');
    });

    it('rejects a malformed branch id', async () => {
      const res = await http()
        .get('/api/v1/context')
        .set('Authorization', await bearer())
        .set('x-branch-id', "1' OR '1'='1")
        .expect(400);
      expect(res.body.error.code).toBe('INVALID_BRANCH_ID');
    });
  });

  describe('swagger', () => {
    it('serves the UI and an OpenAPI document under the versioned prefix', async () => {
      await http().get('/api/docs').expect(200);
      const doc = await http().get('/api/docs-json').expect(200);
      const paths = Object.keys(doc.body.paths);
      expect(paths).toEqual(expect.arrayContaining(['/api/v1/health', '/api/v1/context']));
      expect(doc.body.components.securitySchemes).toHaveProperty('bearer');
    });
  });
});
