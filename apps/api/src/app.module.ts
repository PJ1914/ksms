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
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { CustomersModule } from './modules/customers/customers.module';
import { CollectionsModule } from './modules/collections/collections.module';
import { FinanceModule } from './modules/finance/finance.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { SalesModule } from './modules/sales/sales.module';
import { SyncModule } from './modules/sync/sync.module';
import { NumberingModule } from './common/numbering/numbering.module';
import { IdempotencyModule } from './common/idempotency/idempotency.module';
import { ContextModule } from './modules/context/context.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { OrganizationModule } from './modules/organization/organization.module';

/** The sign-in identifier of a login request, normalised; null for other requests. */
function loginIdentifier(req: { body?: unknown }): string | null {
  const id = (req.body as { identifier?: unknown } | undefined)?.identifier;
  return typeof id === 'string' && id.trim() !== '' ? id.trim().toLowerCase().slice(0, 100) : null;
}

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
        {
          // Same limit per sign-in identifier, whatever the IP, so one account cannot be sprayed from
          // many addresses (FIXES F13). Unknown and known identifiers are treated alike.
          name: 'auth-identifier',
          ttl: 60_000,
          limit: env.AUTH_THROTTLE_LIMIT,
          skipIf: (ctx) =>
            !Reflect.getMetadata(AUTH_THROTTLED, ctx.getHandler()) ||
            loginIdentifier(ctx.switchToHttp().getRequest()) === null,
          getTracker: (req) => `identifier:${loginIdentifier(req)}`,
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
    NumberingModule,
    InventoryModule,
    ProcurementModule,
    FinanceModule,
    CustomersModule,
    CollectionsModule,
    SalesModule,
    ReportingModule,
    SyncModule,
    NotificationsModule,
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
