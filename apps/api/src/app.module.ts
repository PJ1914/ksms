import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from './common/auth/auth.guard';
import { AuthModule } from './common/auth/auth.module';
import { AUTH_THROTTLED } from './common/auth/decorators';
import { PermissionGuard } from './common/auth/permission.guard';
import { loggerOptions } from './common/logging/logger.config';
import { TenantGuard } from './common/tenant/tenant.guard';
import { ConfigModule, ENV, type Env } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { AuditModule } from './modules/audit/audit.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { ContextModule } from './modules/context/context.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationModule } from './modules/organization/organization.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerOptions(env) }),
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => [
        { name: 'default', ttl: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT },
        {
          // Stricter per-IP limit, applied only to routes marked @AuthThrottled() (login, register, refresh, accept-invitation).
          name: 'auth',
          ttl: 60_000,
          limit: env.AUTH_THROTTLE_LIMIT,
          skipIf: (ctx) => !Reflect.getMetadata(AUTH_THROTTLED, ctx.getHandler()),
        },
      ],
    }),
    DatabaseModule,
    AuthModule,
    AuditModule,
    HealthModule,
    ContextModule,
    OrganizationModule,
    IdentityModule,
    CatalogModule,
    IdempotencyModule,
    InventoryModule,
  ],
  providers: [
    // Guard order matters: rate limit -> authenticate -> tenant context -> permission (default deny).
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
