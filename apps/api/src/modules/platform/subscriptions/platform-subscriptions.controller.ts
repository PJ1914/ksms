import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IDEMPOTENCY_HEADER } from '@ksms/constants';
import { CurrentAdmin, PlatformRoles, PlatformRoute } from '../platform.decorators';
import { platformMeta, type PlatformPrincipal, type PlatformRequest } from '../platform.types';
import {
  AdjustSubscriptionDto,
  ChangePlanDto,
  ExtendSubscriptionDto,
  QuoteQuery,
  RefundDto,
} from './platform-subscriptions.dto';
import { PlatformSubscriptionsService } from './platform-subscriptions.service';

@ApiTags('Platform: subscriptions')
@ApiBearerAuth()
@PlatformRoute()
@Controller('admin/v1/shops/:orgId/subscription')
export class PlatformSubscriptionsController {
  constructor(private readonly subs: PlatformSubscriptionsService) {}

  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get()
  @ApiOperation({ summary: 'State, plan, dates and history of one shop' })
  get(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.subs.get(orgId);
  }

  @PlatformRoles('ADMIN')
  @Get('quote')
  @ApiOperation({ summary: 'Price of N months (with the multi-month discount) before recording' })
  quote(@Param('orgId', ParseUUIDPipe) orgId: string, @Query() q: QuoteQuery) {
    return this.subs.quote(orgId, q.months, q.planId);
  }

  @PlatformRoles('ADMIN')
  @HttpCode(200)
  @Post('extend')
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    description: 'UUID; a double click extends once',
  })
  @ApiOperation({
    summary: 'Record a manual payment and extend by N months (optionally change plan / unlock)',
  })
  extend(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Headers(IDEMPOTENCY_HEADER) key: string | undefined,
    @Body() dto: ExtendSubscriptionDto,
    @Req() req: PlatformRequest,
  ) {
    return this.subs.extend(a, orgId, key, dto, platformMeta(req));
  }

  @PlatformRoles('ADMIN')
  @HttpCode(200)
  @Post('change-plan')
  @ApiOperation({ summary: 'Move the shop to another plan; dates unchanged' })
  changePlan(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ChangePlanDto,
    @Req() req: PlatformRequest,
  ) {
    return this.subs.changePlan(a, orgId, dto, platformMeta(req));
  }

  @PlatformRoles('ADMIN')
  @HttpCode(200)
  @Post('adjust')
  @ApiOperation({ summary: 'Correct the end date or grace days by hand (reason required)' })
  adjust(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: AdjustSubscriptionDto,
    @Req() req: PlatformRequest,
  ) {
    return this.subs.adjust(a, orgId, dto, platformMeta(req));
  }

  @PlatformRoles('ADMIN')
  @HttpCode(200)
  @Post('refund')
  @ApiOperation({ summary: 'Refund a payment (negative payment row; dates unchanged)' })
  refund(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: RefundDto,
    @Req() req: PlatformRequest,
  ) {
    return this.subs.refund(a, orgId, dto, platformMeta(req));
  }
}
