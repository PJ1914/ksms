// Deterministic environment for tests; never uses real credentials.
process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.THROTTLE_LIMIT = '1000';
process.env.THROTTLE_TTL_MS = '60000';
delete process.env.CORS_ORIGINS;
delete process.env.SWAGGER_ENABLED;
