import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '../../common/auth/auth.types';
import { AllowWhenLocked, RequirePermission, Tenant } from '../../common/auth/decorators';
import { SubscriptionService } from './subscription.service';

@ApiTags('Subscription')
@ApiBearerAuth()
@Controller('subscription')
export class SubscriptionController {
  constructor(private readonly subscriptions: SubscriptionService) {}

  /** Owner (and anyone with shop-settings rights) sees plan, dates and history; works while locked. */
  @Get()
  @AllowWhenLocked()
  @RequirePermission('organization.manage')
  @ApiOperation({ summary: "This shop's plan, end date, state and subscription history" })
  get(@Tenant() t: TenantContext) {
    return this.subscriptions.detail(t.organizationId);
  }
}
