import { PATH_METADATA } from '@nestjs/common/constants';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { PLATFORM_PREFIX } from '@ksms/constants';
import { IS_PLATFORM } from '../../common/auth/decorators';
import { PLATFORM_PUBLIC, PLATFORM_ROLES_KEY } from './platform.decorators';
import { PlatformModule } from './platform.module';

/**
 * DEFAULT DENY, checked statically (ADR-001): every platform controller is a @PlatformRoute under
 * /admin/v1, and every one of its handlers declares @PlatformRoles or @PlatformPublic. PlatformGuard also
 * refuses an undeclared route at runtime; this test stops one from being merged at all.
 */
type Ctor = { name: string; prototype: Record<string, unknown> };
const controllers = (Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, PlatformModule) ??
  []) as Ctor[];

describe('platform routes', () => {
  it('the module has controllers', () => {
    expect(controllers.length).toBeGreaterThan(0);
  });

  it.each(controllers.map((c) => [c.name, c] as const))(
    '%s is a platform route under /admin/v1',
    (_, c) => {
      expect(Reflect.getMetadata(IS_PLATFORM, c)).toBe(true);
      const base = String(Reflect.getMetadata(PATH_METADATA, c));
      expect(base === PLATFORM_PREFIX || base.startsWith(`${PLATFORM_PREFIX}/`)).toBe(true);
    },
  );

  it.each(controllers.map((c) => [c.name, c] as const))(
    'every handler of %s declares who may call it',
    (_, c) => {
      const classRoles = Reflect.getMetadata(PLATFORM_ROLES_KEY, c) as unknown[] | undefined;
      const undeclared = Object.getOwnPropertyNames(c.prototype)
        .filter((name) => name !== 'constructor')
        .filter(
          (name) => Reflect.getMetadata(PATH_METADATA, c.prototype[name] as object) !== undefined,
        )
        .filter((name) => {
          const handler = c.prototype[name] as object;
          const roles =
            (Reflect.getMetadata(PLATFORM_ROLES_KEY, handler) as unknown[] | undefined) ??
            classRoles;
          const isPublic = Reflect.getMetadata(PLATFORM_PUBLIC, handler) === true;
          return !isPublic && !(roles && roles.length > 0);
        });
      expect(undeclared).toEqual([]);
    },
  );
});
