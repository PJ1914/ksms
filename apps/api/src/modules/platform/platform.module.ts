import { Module } from '@nestjs/common';
import { PasswordService } from '../identity/password.service';
import { SubscriptionModule } from '../subscription/subscription.module';
import { PlatformAdminsController } from './admins/platform-admins.controller';
import { PlatformAdminsService } from './admins/platform-admins.service';
import { PlatformAuditController } from './audit/platform-audit.controller';
import { PlatformAuditService } from './audit/platform-audit.service';
import { PlatformAuthController } from './auth/platform-auth.controller';
import { DashboardController } from './dashboard/dashboard.controller';
import { PlatformAuthService } from './auth/platform-auth.service';
import { PlatformGuard } from './auth/platform.guard';
import { PlatformKeys } from './auth/platform-keys';
import { PlatformLockoutService } from './auth/platform-lockout.service';
import { PlatformSessionService } from './auth/platform-session.service';
import { PlatformTokenService } from './auth/platform-token.service';
import { PaymentsController, PlansController } from './plans/plans.controller';
import { ShopsController } from './shops/shops.controller';
import { UsersController } from './users/users.controller';
import { UsersService } from './users/users.service';
import { PlatformSupportController } from './support/platform-support.controller';
import { ShopsService } from './shops/shops.service';
import { PlatformSubscriptionsController } from './subscriptions/platform-subscriptions.controller';
import { PlatformSubscriptionsService } from './subscriptions/platform-subscriptions.service';

/**
 * The platform control plane (ADR-001, ADMIN_PANEL.md): /admin/v1, its own tokens, MFA and audit.
 * The ONLY module allowed to read across organizations. No shop module may import it
 * (architecture.spec.ts).
 */
@Module({
  imports: [SubscriptionModule],
  controllers: [
    PlatformAuthController,
    PlatformAdminsController,
    PlatformAuditController,
    ShopsController,
    PlatformSubscriptionsController,
    PlansController,
    PaymentsController,
    DashboardController,
    PlatformSupportController,
    UsersController,
  ],
  providers: [
    PasswordService,
    PlatformKeys,
    PlatformTokenService,
    PlatformGuard,
    PlatformSessionService,
    PlatformLockoutService,
    PlatformAuditService,
    PlatformAuthService,
    PlatformAdminsService,
    ShopsService,
    PlatformSubscriptionsService,
    UsersService,
  ],
  exports: [PlatformGuard, PlatformTokenService, PlatformKeys, PlatformAdminsService],
})
export class PlatformModule {}
