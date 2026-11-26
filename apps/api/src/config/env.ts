import { z } from 'zod';

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL is required')
    .refine((v) => v.startsWith('postgresql://') || v.startsWith('postgres://'), {
      message: 'DATABASE_URL must be a PostgreSQL connection string',
    }),
  // Connection pool per API instance. Keep DB_POOL_MAX x instances under the Neon pooler's limit.
  DB_POOL_MAX: z.coerce.number().int().min(1).max(20).default(5),
  DB_POOL_IDLE_MS: z.coerce.number().int().min(1000).max(600_000).default(10_000),
  DB_POOL_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60_000).default(10_000),
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().min(60).max(3600).default(900),
  REFRESH_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(30),
  AUTH_THROTTLE_LIMIT: z.coerce.number().int().min(1).default(10), // login/register/refresh per minute per IP
  // Optional Postgres schema (used by integration tests to isolate data in a throwaway schema).
  DATABASE_SCHEMA: z
    .string()
    .regex(/^[a-z_][a-z0-9_]{0,62}$/)
    .optional(),
  THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
  THROTTLE_TTL_MS: z.coerce.number().int().min(1000).default(60_000),
  CORS_ORIGINS: csv,
  SWAGGER_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
});

export type Env = z.infer<typeof envSchema>;

/** Validates process.env once at startup. Fails fast with a readable message (never prints values). */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${problems}`);
  }
  return result.data;
}
