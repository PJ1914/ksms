// Deterministic environment for tests; never uses real credentials.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.THROTTLE_LIMIT = '1000';
process.env.THROTTLE_TTL_MS = '60000';
delete process.env.CORS_ORIGINS;
delete process.env.SWAGGER_ENABLED;
process.env.AUTH_THROTTLE_LIMIT = '1000';
process.env.REFRESH_TTL_DAYS = '30';
delete process.env.DATABASE_SCHEMA;
// Platform plane (test-only values).
process.env.PLATFORM_JWT_SECRET = 'platform-test-secret-platform-test-secret-platform-1234';
process.env.PLATFORM_MFA_KEY = Buffer.alloc(32, 7).toString('base64');
process.env.PLATFORM_AUTH_THROTTLE_LIMIT = '1000';
delete process.env.PLATFORM_ADMIN_IP_ALLOWLIST;
delete process.env.PLATFORM_ADMIN_ORIGINS;
