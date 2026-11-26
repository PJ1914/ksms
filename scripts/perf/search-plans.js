/* eslint-disable @typescript-eslint/no-require-imports */
// Usage: node scripts/perf/<file>.js apps/api   (reads DIRECT_URL from apps/api/.env; read-only or throwaway schema)
// Measures F10 search plans on a throwaway schema. Usage: node trgm.js <apps/api dir> [skip-trgm]
const fs = require('fs'),
  path = require('path');
const apiDir = process.argv[2];
require(path.join(apiDir, 'node_modules/dotenv')).config({ path: path.join(apiDir, '.env') });
const { Client } = require(path.join(apiDir, 'node_modules/pg'));
const skipTrgm = process.argv[3] === 'skip-trgm';
(async () => {
  const c = new Client({ connectionString: process.env.DIRECT_URL });
  await c.connect();
  const schema = 'bench_' + Date.now().toString(36);
  await c.query(`CREATE SCHEMA ${schema}`);
  await c.query(`SET search_path TO ${schema}`);
  try {
    const mig = path.join(apiDir, 'prisma/migrations');
    for (const d of fs
      .readdirSync(mig)
      .filter((d) => fs.statSync(path.join(mig, d)).isDirectory())
      .sort()) {
      if (skipTrgm && d.includes('trigram')) continue;
      await c.query(fs.readFileSync(path.join(mig, d, 'migration.sql'), 'utf8'));
    }
    const org = '0190a000-0000-7000-8000-000000000001';
    await c.query(`INSERT INTO organizations (id, name, updated_at) VALUES ($1, 'Bench', now())`, [
      org,
    ]);
    const unit = (await c.query(`SELECT id FROM units_of_measurement LIMIT 1`)).rows[0];
    let unitId = unit && unit.id;
    if (!unitId) {
      unitId = '0190a000-0000-7000-8000-0000000000aa';
      await c
        .query(
          `INSERT INTO units_of_measurement (id, code, name, dimension) VALUES ($1,'PCS','Piece','COUNT')`,
          [unitId],
        )
        .catch(async (e) => {
          console.error('unit insert:', e.message);
          throw e;
        });
    }
    const words = [
      'rice',
      'atta',
      'dal',
      'sugar',
      'salt',
      'oil',
      'soap',
      'tea',
      'biscuit',
      'masala',
      'ghee',
      'paneer',
      'milk',
      'bread',
      'jam',
      'ravva',
      'rava',
      'maida',
      'besan',
      'poha',
    ];
    await c.query(
      `
      INSERT INTO products (id, organization_id, sku, name, local_name, type, base_unit_id, updated_at)
      SELECT gen_random_uuid(), $1, 'SKU' || g, ($2::text[])[1 + (g % 20)] || ' brand ' || md5(g::text), NULL, 'COUNT', $3, now()
      FROM generate_series(1, 50000) g`,
      [org, words, unitId],
    );
    await c.query(
      `
      INSERT INTO customers (id, organization_id, name, phone, updated_at)
      SELECT gen_random_uuid(), $1, 'Customer ' || md5(g::text), '9' || lpad(g::text, 9, '0'), now()
      FROM generate_series(1, 20000) g`,
      [org],
    );
    await c.query('ANALYZE');
    const show = async (label, sql, params) => {
      const r = await c.query('EXPLAIN (ANALYZE, BUFFERS) ' + sql, params);
      const plan = r.rows.map((x) => x['QUERY PLAN']);
      const exec = plan.find((l) => l.startsWith('Execution Time'));
      const scans = plan.filter((l) => /Scan|BitmapOr/.test(l)).map((l) => l.trim().slice(0, 90));
      console.log(`\n## ${label}: ${exec}\n  ${scans.slice(0, 6).join('\n  ')}`);
    };
    console.log(
      (
        await c.query(
          "SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND indexname LIKE '%trgm%'",
          [schema],
        )
      ).rows
        .map((r) => r.indexname)
        .join(', '),
    );
    const p = '%3f9a%';
    await show(
      'name only',
      'SELECT id FROM products WHERE organization_id=$1 AND deleted_at IS NULL AND name ILIKE $2',
      [org, p],
    );
    await c.query('SET enable_seqscan = off');
    await show(
      '3-col OR, seqscan off',
      'SELECT id FROM products WHERE organization_id=$1 AND deleted_at IS NULL AND (name ILIKE $2 OR local_name ILIKE $2 OR sku ILIKE $2)',
      [org, p],
    );
    await c.query('SET enable_seqscan = on');
    await show(
      'products 3-col OR (no barcode branch)',
      `SELECT id FROM products WHERE organization_id=$1 AND deleted_at IS NULL AND (name ILIKE $2 OR local_name ILIKE $2 OR sku ILIKE $2) ORDER BY name, id LIMIT 25`,
      [org, p],
    );
    await show(
      'products OR incl. barcode subquery (current Prisma shape)',
      `SELECT id FROM products WHERE organization_id=$1 AND deleted_at IS NULL AND (name ILIKE $2 OR local_name ILIKE $2 OR sku ILIKE $2 OR id IN (SELECT product_id FROM product_barcodes WHERE barcode LIKE $3)) ORDER BY name, id LIMIT 25`,
      [org, p, 'sugar%'],
    );
    await show(
      'products UNION (index-friendly shape)',
      `SELECT id FROM products WHERE organization_id=$1 AND deleted_at IS NULL AND id IN (
         SELECT id FROM products WHERE organization_id=$1 AND deleted_at IS NULL AND (name ILIKE $2 OR local_name ILIKE $2 OR sku ILIKE $2)
         UNION SELECT product_id FROM product_barcodes WHERE organization_id=$1 AND barcode LIKE $3) ORDER BY name, id LIMIT 25`,
      [org, p, 'sugar%'],
    );
    await show(
      'customers name/phone/gstin OR',
      `SELECT id FROM customers WHERE organization_id=$1 AND deleted_at IS NULL AND (name ILIKE $2 OR phone LIKE $3 OR gstin LIKE $3) ORDER BY name, id LIMIT 25`,
      [org, '%3f9a%', '%19876%'],
    );
    const t0 = Date.now();
    await c.query(
      `INSERT INTO products (id, organization_id, sku, name, type, base_unit_id, updated_at) SELECT gen_random_uuid(), $1, 'NEW'||g, 'new product '||g, 'COUNT', $2, now() FROM generate_series(1,500) g`,
      [org, unitId],
    );
    console.log(`\n## 500 product inserts: ${Date.now() - t0} ms`);
  } finally {
    await c.query(`DROP SCHEMA ${schema} CASCADE`);
    await c.end();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
