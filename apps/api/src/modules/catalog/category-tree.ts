import type { Db } from '../../database/db.types';

/**
 * `rootId` plus every non-deleted descendant category of the organization, in ONE recursive query
 * (FIXES F11; it used to load every category of the shop and walk the tree in memory).
 *
 * Same rules as before: the root is always included; a child is reached only through a non-deleted
 * parent of the same organization. `UNION` (not `UNION ALL`) stops on cycles; depth is capped at 20.
 */
export async function descendantCategoryIds(
  db: Db,
  organizationId: string,
  rootId: string,
): Promise<string[]> {
  const rows = await db.$queryRaw<{ id: string }[]>`
    WITH RECURSIVE tree (id, depth) AS (
      SELECT ${rootId}::uuid, 0
      UNION
      SELECT c.id, t.depth + 1
      FROM product_categories c
      JOIN tree t ON c.parent_id = t.id
      WHERE c.organization_id = ${organizationId}::uuid
        AND c.deleted_at IS NULL
        AND t.depth < 20
    )
    SELECT DISTINCT id::text AS id FROM tree`;
  return rows.map((r) => r.id);
}
