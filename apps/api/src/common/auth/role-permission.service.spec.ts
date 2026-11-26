import { ROLE_CACHE_TTL_MS, RolePermissionService } from './role-permission.service';

describe('RolePermissionService (FIXES F16)', () => {
  const role = (keys: string[]) => ({
    name: 'Cashier',
    isSystem: false,
    permissions: keys.map((key) => ({ permission: { key } })),
  });
  const setup = () => {
    const findUnique = jest.fn().mockResolvedValue(role(['sale.create']));
    const svc = new RolePermissionService({ role: { findUnique } } as never);
    return { svc, findUnique };
  };
  beforeEach(() => jest.useFakeTimers({ now: new Date('2026-11-26T10:00:00Z') }));
  afterEach(() => jest.useRealTimers());

  it('caches for 10 seconds', async () => {
    const { svc, findUnique } = setup();
    await svc.get('r1');
    await svc.get('r1');
    expect(findUnique).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(ROLE_CACHE_TTL_MS + 1);
    await svc.get('r1');
    expect(findUnique).toHaveBeenCalledTimes(2);
    expect(ROLE_CACHE_TTL_MS).toBe(10_000);
  });

  it('fresh reads skip the cache and refresh it', async () => {
    const { svc, findUnique } = setup();
    await svc.get('r1');
    findUnique.mockResolvedValue(role([]));
    expect((await svc.get('r1', { fresh: true })).keys.has('sale.create')).toBe(false);
    expect((await svc.get('r1')).keys.has('sale.create')).toBe(false); // the refreshed value
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it('invalidate drops the role at once', async () => {
    const { svc, findUnique } = setup();
    await svc.get('r1');
    svc.invalidate('r1');
    await svc.get('r1');
    expect(findUnique).toHaveBeenCalledTimes(2);
  });
});
