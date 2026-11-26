/* eslint-disable @typescript-eslint/no-require-imports */
// Usage: node scripts/perf/<file>.js apps/api   (reads DIRECT_URL from apps/api/.env; read-only or throwaway schema)
const fs = require('fs'),
  path = require('path');
const apiDir = process.argv[2];
require(path.join(apiDir, 'node_modules/dotenv')).config({
  path: path.join(apiDir, '.env'),
  quiet: true,
});
const { Client } = require(path.join(apiDir, 'node_modules/pg'));
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  const s = 'deep_' + Date.now().toString(36);
  try {
    await c.query(`CREATE SCHEMA ${s}; SET search_path TO ${s}`);
    const mig = path.join(apiDir, 'prisma/migrations');
    for (const d of fs
      .readdirSync(mig)
      .filter((d) => fs.statSync(path.join(mig, d)).isDirectory())
      .sort())
      await c.query(fs.readFileSync(path.join(mig, d, 'migration.sql'), 'utf8'));
    const org = '0190a000-0000-7000-8000-000000000001';
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1,'B',now())`, [org]);
    const unitRow = (await c.query('SELECT id FROM units_of_measurement LIMIT 1')).rows[0];
    const unitId = unitRow.id;
    await c.query(
      `INSERT INTO products (id, organization_id, sku, name, type, base_unit_id, updated_at)
      SELECT gen_random_uuid(), $1, 'S'||g, 'p '||md5(g::text), 'COUNT', $2, now() FROM generate_series(1,50000) g`,
      [org, unitId],
    );
    await c.query('ANALYZE');
    const t = async (label, sql, p) => {
      const r = await c.query('EXPLAIN ANALYZE ' + sql, p);
      console.log(
        label.padEnd(34),
        r.rows.map((x) => x['QUERY PLAN']).find((l) => l.startsWith('Execution')),
      );
    };
    const base = `SELECT id, name FROM products WHERE organization_id=$1 AND deleted_at IS NULL`;
    await t('offset page 1', `${base} ORDER BY name, id LIMIT 25 OFFSET 0`, [org]);
    await t('offset 49,975 (page 2000)', `${base} ORDER BY name, id LIMIT 25 OFFSET 49975`, [org]);
    const deep = (await c.query(`${base} ORDER BY name, id LIMIT 1 OFFSET 49974`, [org])).rows[0];
    await t(
      'keyset after row 49,975',
      `${base} AND (name > $2 OR (name = $2 AND id > $3)) ORDER BY name, id LIMIT 25`,
      [org, deep.name, deep.id],
    );
    await t(
      'count(*) full',
      `SELECT count(*) FROM products WHERE organization_id=$1 AND deleted_at IS NULL`,
      [org],
    );
    await t(
      'count capped at 10,001',
      `SELECT count(*) FROM (SELECT 1 FROM products WHERE organization_id=$1 AND deleted_at IS NULL LIMIT 10001) x`,
      [org],
    );
  } finally {
    await c.query(`DROP SCHEMA ${s} CASCADE`);
    await c.end();
  }
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
