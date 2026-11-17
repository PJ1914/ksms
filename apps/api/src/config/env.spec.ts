import { parseEnv } from './env';

describe('parseEnv', () => {
  const valid = { DATABASE_URL: 'postgresql://u:p@host/db' };

  it('applies defaults', () => {
    const env = parseEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('coerces PORT from string', () => {
    expect(parseEnv({ ...valid, PORT: '8080' }).PORT).toBe(8080);
  });

  it('fails when DATABASE_URL is missing', () => {
    expect(() => parseEnv({})).toThrow(/DATABASE_URL/);
  });

  it('rejects non-postgres URLs', () => {
    expect(() => parseEnv({ DATABASE_URL: 'mysql://x' })).toThrow(/PostgreSQL/);
  });

  it('does not leak the connection string in the error message', () => {
    try {
      parseEnv({ DATABASE_URL: 'mysql://user:supersecret@host/db' });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as Error).message).not.toContain('supersecret');
    }
  });
});
