import { PERMISSIONS, SYSTEM_ROLE_PERMISSIONS } from '@ksms/constants';
import { groupPermissions, permissionLabel, summarizeRole } from './permissions';

describe('groupPermissions', () => {
  it('puts every permission in exactly one section, with nothing left over', () => {
    const groups = groupPermissions();
    const all = groups.flatMap((g) => g.keys);
    expect(all.sort()).toEqual(Object.keys(PERMISSIONS).sort());
    expect(new Set(all).size).toBe(all.length);
    expect(groups.find((g) => g.title === 'Other')).toBeUndefined();
  });

  it('keeps an unknown key under Other instead of losing it', () => {
    const groups = groupPermissions(['sale.create', 'mystery.thing']);
    expect(groups.map((g) => g.title)).toEqual(['Selling', 'Other']);
  });
});

describe('permissionLabel', () => {
  it('uses the plain description, falling back to the key', () => {
    expect(permissionLabel('sale.create')).toBe('Create sales (POS)');
    expect(permissionLabel('nope.nothing')).toBe('nope.nothing');
  });
});

describe('summarizeRole', () => {
  it('lists the sections a role covers, noting partial ones', () => {
    const lines = summarizeRole(SYSTEM_ROLE_PERMISSIONS.Cashier);
    expect(lines.some((l) => l.startsWith('Selling ('))).toBe(true);
    expect(lines.join('|')).not.toMatch(/Money|Buying|Reports/);
  });
  it('shows a section name alone when the role has all of it', () => {
    expect(summarizeRole(Object.keys(PERMISSIONS))).toContain('Selling');
  });
});
