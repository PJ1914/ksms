/* eslint-disable @typescript-eslint/no-require-imports */
// Usage: node scripts/perf/<file>.js apps/api   (reads DIRECT_URL from apps/api/.env; read-only or throwaway schema)
const path = require('path');
const apiDir = process.argv[2];
require(path.join(apiDir, 'node_modules/dotenv')).config({
  path: path.join(apiDir, '.env'),
  quiet: true,
});
const { Client } = require(path.join(apiDir, 'node_modules/pg'));
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  try {
    const reset = await c.query(
      `SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()`,
    );
    console.log('stats since:', reset.rows[0]?.stats_reset);
    const sizes = await c.query(
      `SELECT relname, n_live_tup FROM pg_stat_user_tables WHERE schemaname='public' AND relname IN ('products','sales','sale_items','stock_movements','customers','payments','inventory_batches','suppliers') ORDER BY relname`,
    );
    console.log(sizes.rows.map((r) => `${r.relname}=${r.n_live_tup}`).join(' '));
    const r = await c.query(
      `
      SELECT indexrelname AS index, relname AS table, idx_scan,
             pg_size_pretty(pg_relation_size(indexrelid)) AS size
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public' AND indexrelname = ANY($1)
      ORDER BY indexrelname`,
      [
        [
          'products_organization_id_status_idx',
          'customers_organization_id_name_idx',
          'suppliers_organization_id_name_idx',
          'suppliers_org_name_unique',
          'inventory_batches_organization_id_expiry_date_idx',
          'inventory_batches_open_expiry_idx',
          'sale_items_sale_id_idx',
          'sale_items_organization_id_product_id_idx',
          'payments_organization_id_branch_id_paid_at_idx',
        ],
      ],
    );
    for (const x of r.rows)
      console.log(`${x.index.padEnd(52)} scans=${String(x.idx_scan).padStart(6)} size=${x.size}`);
    const unused = await c.query(
      `SELECT count(*) AS n FROM pg_stat_user_indexes WHERE schemaname='public' AND idx_scan = 0`,
    );
    const all = await c.query(
      `SELECT count(*) AS n FROM pg_stat_user_indexes WHERE schemaname='public'`,
    );
    console.log(`indexes with 0 scans: ${unused.rows[0].n} of ${all.rows[0].n}`);
    const mig = await c.query(
      `SELECT migration_name FROM _prisma_migrations ORDER BY finished_at DESC NULLS LAST LIMIT 3`,
    );
    console.log('latest applied migrations:', mig.rows.map((m) => m.migration_name).join(', '));
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
