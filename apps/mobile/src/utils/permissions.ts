import { PERMISSIONS } from '@ksms/constants';

export interface PermissionGroup {
  title: string;
  /** Permission keys in this section, in catalogue order. */
  keys: string[];
}

/** The sections a shop owner thinks in. Every permission key belongs to exactly one. */
const SECTIONS: { title: string; prefixes: string[] }[] = [
  { title: 'Products and stock', prefixes: ['product', 'category', 'stock'] },
  { title: 'Selling', prefixes: ['sale', 'discount', 'price'] },
  {
    title: 'Customers and khata',
    prefixes: ['customer', 'khata', 'credit', 'ledger', 'collection'],
  },
  { title: 'Buying', prefixes: ['purchase', 'supplier'] },
  { title: 'Money', prefixes: ['expense', 'cashbook', 'closing'] },
  { title: 'Reports', prefixes: ['report', 'system'] },
  {
    title: 'Shop and staff',
    prefixes: ['organization', 'branch', 'employee', 'invitation', 'role', 'audit', 'backup'],
  },
  { title: 'Help and support', prefixes: ['support'] },
];

/** What a permission lets the person do, in plain words ("Create sales (POS)"). */
export const permissionLabel = (key: string): string =>
  (PERMISSIONS as Record<string, string>)[key] ?? key;

/** The whole catalogue split into sections (an unknown key, if one ever appears, goes under "Other"). */
export function groupPermissions(
  keys: readonly string[] = Object.keys(PERMISSIONS),
): PermissionGroup[] {
  const groups: PermissionGroup[] = SECTIONS.map((s) => ({ title: s.title, keys: [] }));
  const other: PermissionGroup = { title: 'Other', keys: [] };
  for (const key of keys) {
    const prefix = key.split('.')[0] ?? '';
    const i = SECTIONS.findIndex((s) => s.prefixes.includes(prefix));
    (groups[i] ?? other).keys.push(key);
  }
  return [...groups, other].filter((g) => g.keys.length > 0);
}

/** "Selling 4/7, Customers and khata 2/9": what a role covers, section by section. */
export function summarizeRole(granted: readonly string[]): string[] {
  const have = new Set(granted);
  return groupPermissions()
    .map((g) => ({
      title: g.title,
      n: g.keys.filter((k) => have.has(k)).length,
      of: g.keys.length,
    }))
    .filter((g) => g.n > 0)
    .map((g) => (g.n === g.of ? g.title : `${g.title} (${g.n}/${g.of})`));
}
