import 'dotenv/config'; // Prisma 7 no longer loads .env automatically
import { defineConfig } from 'prisma/config';

// Migrations use the DIRECT (non-pooled) Neon URL; the running app uses DATABASE_URL (pooled).
// `prisma generate` and `prisma validate` need no database, so the URL is only attached when set.
// Commands that connect (migrate deploy/status) then fail with a clear "datasource url" error if it is missing.
const directUrl = process.env.DIRECT_URL;

export default defineConfig({
  schema: 'prisma/schema',
  migrations: { path: 'prisma/migrations' },
  ...(directUrl ? { datasource: { url: directUrl } } : {}),
});
