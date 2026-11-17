import 'dotenv/config'; // Prisma 7 no longer loads .env automatically
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Migrations use the DIRECT (non-pooled) Neon URL; the running app uses DATABASE_URL (pooled).
    url: env('DIRECT_URL'),
  },
});
