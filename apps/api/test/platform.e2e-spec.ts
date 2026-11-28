import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AccessTokenService } from '../src/common/auth/access-token.service';
import { SessionCache } from '../src/common/auth/session-cache';
import { PlatformTokenService } from '../src/modules/platform/auth/platform-token.service';
import { createPrismaMock, createTestApp, ids } from './test-app';

/** ADR-001: the shop plane and the platform plane never accept each other's tokens. */
const admin = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  session: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
};

describe('platform plane (e2e, database mocked)', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let shopTokens: AccessTokenService;
  let platformTokens: PlatformTokenService;
  const prisma = Object.assign(createPrismaMock(), {
    platformAdminSession: { findUnique: jest.fn() },
    platformAdmin: { findUniqueOrThrow: jest.fn(), findMany: jest.fn() },
  });

  const platformSession = (
    over: Partial<{
      role: 'ADMIN' | 'SUPPORT';
      mustChangePassword: boolean;
      revokedAt: Date | null;
    }> = {},
  ) => ({
    adminId: admin.id,
    revokedAt: over.revokedAt ?? null,
    expiresAt: new Date(Date.now() + 3_600_000),
    admin: {
      isActive: true,
      role: over.role ?? 'ADMIN',
      mustChangePassword: over.mustChangePassword ?? false,
      mfaEnabledAt: new Date(),
    },
  });

  beforeAll(async () => {
    app = await createTestApp(prisma);
    http = () => request(app.getHttpServer());
    shopTokens = app.get(AccessTokenService);
    platformTokens = app.get(PlatformTokenService);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.resetAllMocks();
    app.get(SessionCache).reset();
    prisma.userSession.findUnique.mockResolvedValue({
      userId: ids.user,
      organizationId: ids.org,
      revokedAt: null,
      expiresAt: new Date(Date.now() + 3_600_000),
      createdAt: new Date(Date.now() - 60_000),
      user: { isActive: true, tokenVersion: 0 },
    });
    prisma.organizationMember.findUnique.mockResolvedValue({
      id: ids.member,
      roleId: ids.role,
      status: 'ACTIVE',
      branches: [],
    });
    prisma.platformAdminSession.findUnique.mockResolvedValue(platformSession());
    prisma.platformAdmin.findUniqueOrThrow.mockResolvedValue({ id: admin.id, email: 'a@x.in' });
    prisma.platformAdmin.findMany.mockResolvedValue([]);
  });

  const shopBearer = async () =>
    `Bearer ${await shopTokens.sign({ sub: ids.user, sid: ids.session, org: ids.org, v: 0 })}`;
  const adminBearer = async (role: 'ADMIN' | 'SUPPORT' = 'ADMIN') =>
    `Bearer ${await platformTokens.signAccess({ sub: admin.id, sid: admin.session, role })}`;

  it('platform routes live at /admin/v1, outside the shop prefix', async () => {
    await http().post('/admin/v1/auth/login').send({}).expect(400); // reached: validation runs
    await http().post('/api/v1/admin/v1/auth/login').send({}).expect(404);
  });

  it('a shop token is refused by the platform plane', async () => {
    const res = await http()
      .get('/admin/v1/me')
      .set('Authorization', await shopBearer())
      .expect(401);
    expect(res.body.error.code).toBe('PLATFORM_UNAUTHORIZED');
    expect(prisma.platformAdminSession.findUnique).not.toHaveBeenCalled();
  });

  it('a platform token is refused by the shop plane', async () => {
    const res = await http()
      .get('/api/v1/test/no-policy')
      .set('Authorization', await adminBearer())
      .expect(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(prisma.userSession.findUnique).not.toHaveBeenCalled();
  });

  it('an mfaToken is not an access token', async () => {
    const mfa = await platformTokens.signMfa({ sub: admin.id, pwf: 'x' });
    await http().get('/admin/v1/me').set('Authorization', `Bearer ${mfa}`).expect(401);
  });

  it('no token → 401; valid admin → 200', async () => {
    await http().get('/admin/v1/me').expect(401);
    await http()
      .get('/admin/v1/me')
      .set('Authorization', await adminBearer())
      .expect(200);
  });

  it('a revoked platform session is refused at once', async () => {
    prisma.platformAdminSession.findUnique.mockResolvedValue(
      platformSession({ revokedAt: new Date() }),
    );
    await http()
      .get('/admin/v1/me')
      .set('Authorization', await adminBearer())
      .expect(401);
  });

  it('SUPPORT cannot reach ADMIN-only routes; the role comes from the DB, not the token', async () => {
    prisma.platformAdminSession.findUnique.mockResolvedValue(platformSession({ role: 'SUPPORT' }));
    // Token still says ADMIN (issued before a demotion): the DB role wins.
    const res = await http()
      .get('/admin/v1/admins')
      .set('Authorization', await adminBearer('ADMIN'))
      .expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    await http()
      .get('/admin/v1/me')
      .set('Authorization', await adminBearer('SUPPORT'))
      .expect(200);
  });

  it('ADMIN can list admins', async () => {
    await http()
      .get('/admin/v1/admins')
      .set('Authorization', await adminBearer())
      .expect(200);
  });

  it('a temporary password must be changed before anything else', async () => {
    prisma.platformAdminSession.findUnique.mockResolvedValue(
      platformSession({ mustChangePassword: true }),
    );
    const res = await http()
      .get('/admin/v1/admins')
      .set('Authorization', await adminBearer())
      .expect(403);
    expect(res.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    await http()
      .get('/admin/v1/me')
      .set('Authorization', await adminBearer())
      .expect(200);
  });

  it('the admin API has its own Swagger document, separate from the shop one', async () => {
    const platformDoc = await http().get('/admin/v1/docs-json').expect(200);
    const shopDoc = await http().get('/api/docs-json').expect(200);
    const platformPaths = Object.keys(platformDoc.body.paths as object);
    const shopPaths = Object.keys(shopDoc.body.paths as object);
    expect(platformPaths).toContain('/admin/v1/auth/login');
    expect(platformPaths.every((p) => p.startsWith('/admin/v1/'))).toBe(true);
    expect(shopPaths.some((p) => p.startsWith('/admin/v1/'))).toBe(false);
    expect(shopPaths).toContain('/api/v1/auth/login');
  });

  it('shop routes keep working with shop tokens', async () => {
    prisma.role.findUnique.mockResolvedValue({ name: 'Owner', isSystem: true, permissions: [] });
    await http()
      .get('/api/v1/test/needs-sale')
      .set('Authorization', await shopBearer())
      .expect(200);
  });
});
