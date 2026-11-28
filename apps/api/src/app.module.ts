import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from './common/auth/auth.guard';
import { AuthModule } from './common/auth/auth.module';
import { AUTH_THROTTLED } from './common/auth/decorators';
import { ReconcileModule } from './common/reconcile/reconcile.module';
import { RECONCILE_THROTTLED } from './common/reconcile/reconciliation-runner';
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
import { PlatformGuard } from './modules/platform/auth/platform.guard';
import { PLATFORM_AUTH_THROTTLED } from './modules/platform/platform.decorators';
import { PlatformModule } from './modules/platform/platform.module';
import { SubscriptionModule } from './modules/subscription/subscription.module';
import { SupportModule } from './modules/support/support.module';

/** The sign-in identifier of a login request, normalised; null for other requests. */
function loginIdentifier(req: { body?: unknown }): string | null {
  const id = (req.body as { identifier?: unknown } | undefined)?.identifier;
  return typeof id === 'string' && id.trim() !== '' ? id.trim().toLowerCase().slice(0, 100) : null;
}

/** The email of an admin-panel login request (ADR-001), normalised; null for other requests. */
function platformLoginEmail(req: { body?: unknown }): string | null {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  return typeof email === 'string' && email.trim() !== ''
    ? email.trim().toLowerCase().slice(0, 254)
    : null;
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
        {
          // Admin panel login and MFA steps (ADR-001): PLATFORM_AUTH_THROTTLE_LIMIT a minute per IP...
          name: 'platform-auth',
          ttl: 60_000,
          limit: env.PLATFORM_AUTH_THROTTLE_LIMIT,
          skipIf: (ctx) => !Reflect.getMetadata(PLATFORM_AUTH_THROTTLED, ctx.getHandler()),
        },
        {
          // ...and the same per admin email, whatever the IP.
          name: 'platform-auth-email',
          ttl: 60_000,
          limit: env.PLATFORM_AUTH_THROTTLE_LIMIT,
          skipIf: (ctx) =>
            !Reflect.getMetadata(PLATFORM_AUTH_THROTTLED, ctx.getHandler()) ||
            platformLoginEmail(ctx.switchToHttp().getRequest()) === null,
          getTracker: (req) => `platform-email:${platformLoginEmail(req)}`,
        },
        {
          // Reconciliation scans all history (FIXES F21): at most RECONCILE_THROTTLE_LIMIT a minute.
          name: 'reconcile',
          ttl: 60_000,
          limit: env.RECONCILE_THROTTLE_LIMIT,
          skipIf: (ctx) => !Reflect.getMetadata(RECONCILE_THROTTLED, ctx.getHandler()),
        },
      ],
    }),
    DatabaseModule,
    AuthModule,
    ReconcileModule,
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
    PlatformModule,
    SubscriptionModule,
    SupportModule,
  ],
  providers: [
    // Guard order matters: rate limit -> platform plane (acts only on /admin/v1) -> authenticate ->
    // tenant context -> permission (default deny). The shop guards skip @PlatformRoute() controllers.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: PlatformGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionGuard },
  ],
})
export class AppModule {}
