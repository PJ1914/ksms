import { parseEnv } from './env';

describe('parseEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@host/db',
    JWT_ACCESS_SECRET: 'x'.repeat(32),
  };

  it('applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.THROTTLE_LIMIT).toBe(120);
    expect(env.CORS_ORIGINS).toEqual([]);
    expect(env.SWAGGER_ENABLED).toBeUndefined();
  });

  it('coerces PORT from string and parses CORS origins', () => {
    const env = parseEnv({ ...valid, PORT: '8080', CORS_ORIGINS: 'http://a.com, http://b.com' });
    expect(env.PORT).toBe(8080);
    expect(env.CORS_ORIGINS).toEqual(['http://a.com', 'http://b.com']);
  });

  it('has bounded database pool settings (FIXES F3)', () => {
    const env = parseEnv(valid);
    expect(env.DB_POOL_MAX).toBe(5);
    expect(env.DB_POOL_IDLE_MS).toBe(10_000);
    expect(env.DB_POOL_CONNECT_TIMEOUT_MS).toBe(10_000);
    expect(parseEnv({ ...valid, DB_POOL_MAX: '20' }).DB_POOL_MAX).toBe(20);
    expect(() => parseEnv({ ...valid, DB_POOL_MAX: '0' })).toThrow(/DB_POOL_MAX/);
    expect(() => parseEnv({ ...valid, DB_POOL_MAX: '21' })).toThrow(/DB_POOL_MAX/);
    expect(() => parseEnv({ ...valid, DB_POOL_CONNECT_TIMEOUT_MS: '10' })).toThrow(
      /DB_POOL_CONNECT_TIMEOUT_MS/,
    );
  });

  it('caps sessions at 90 days and refuses a cap below the refresh TTL (FIXES F5)', () => {
    expect(parseEnv(valid).SESSION_ABSOLUTE_TTL_DAYS).toBe(90);
    expect(() =>
      parseEnv({ ...valid, REFRESH_TTL_DAYS: '30', SESSION_ABSOLUTE_TTL_DAYS: '10' }),
    ).toThrow(/SESSION_ABSOLUTE_TTL_DAYS/);
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => parseEnv({ JWT_ACCESS_SECRET: valid.JWT_ACCESS_SECRET })).toThrow(/DATABASE_URL/);
  });

  it('rejects non-postgres URLs', () => {
    expect(() => parseEnv({ ...valid, DATABASE_URL: 'mysql://x' })).toThrow(/PostgreSQL/);
  });

  it('requires a strong JWT secret', () => {
    expect(() => parseEnv({ DATABASE_URL: valid.DATABASE_URL })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(/at least 32/);
  });

  describe('platform plane (ADR-001)', () => {
    const platform = {
      PLATFORM_JWT_SECRET: 'p'.repeat(48),
      PLATFORM_MFA_KEY: Buffer.alloc(32, 1).toString('base64'),
    };

    it('is optional outside production', () => {
      const env = parseEnv(valid);
      expect(env.PLATFORM_JWT_SECRET).toBeUndefined();
      expect(env.PLATFORM_AUTH_THROTTLE_LIMIT).toBe(5);
    });

    it('is required in production', () => {
      expect(() => parseEnv({ ...valid, NODE_ENV: 'production' })).toThrow(/PLATFORM_JWT_SECRET/);
      expect(() =>
        parseEnv({ ...valid, NODE_ENV: 'production', PLATFORM_JWT_SECRET: 'p'.repeat(48) }),
      ).toThrow(/PLATFORM_MFA_KEY/);
      expect(parseEnv({ ...valid, ...platform, NODE_ENV: 'production' }).NODE_ENV).toBe(
        'production',
      );
    });

    it('needs a long secret that differs from the shop secret, and a 32-byte MFA key', () => {
      expect(() => parseEnv({ ...valid, PLATFORM_JWT_SECRET: 'p'.repeat(47) })).toThrow(/48/);
      const same = 'z'.repeat(48);
      expect(() =>
        parseEnv({ ...valid, JWT_ACCESS_SECRET: same, PLATFORM_JWT_SECRET: same }),
      ).toThrow(/different/);
      expect(() =>
        parseEnv({ ...valid, PLATFORM_MFA_KEY: Buffer.alloc(16).toString('base64') }),
      ).toThrow(/32 bytes/);
    });
  });

  it('does not leak secrets in error messages', () => {
    try {
      parseEnv({
        DATABASE_URL: 'mysql://user:supersecret@host/db',
        JWT_ACCESS_SECRET: 'tiny-secret-value',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('supersecret');
      expect((e as Error).message).not.toContain('tiny-secret-value');
    }
  });
});
