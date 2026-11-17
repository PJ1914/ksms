import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { IDEMPOTENCY_HEADER } from '@ksms/constants';
import type { AppRequest, TenantContext } from '../../common/auth/auth.types';
import { RequireBranch, RequirePermission, Tenant } from '../../common/auth/decorators';
import { RolePermissionService } from '../../common/auth/role-permission.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import {
  BalancesQuery,
  ExpiringQuery,
  MovementsQuery,
  OpeningStockDto,
  StockAdjustmentDto,
} from './inventory.dto';
import { InventoryQueriesService } from './inventory-queries.service';
import { StockAdjustmentsService } from './stock-adjustments.service';

const meta = (req: AppRequest) => ({ correlationId: req.id, ipAddress: req.ip });
const IDEMPOTENCY_DOC = {
  name: 'Idempotency-Key',
  required: true,
  description: 'UUID generated once per user action; retries reuse it',
};

@ApiTags('Inventory')
@ApiBearerAuth()
@ApiSecurity('branch')
@RequireBranch() // stock always belongs to one branch
@Controller('inventory')
export class InventoryController {
  constructor(
    private readonly queries: InventoryQueriesService,
    private readonly adjustments: StockAdjustmentsService,
    private readonly idempotency: IdempotencyService,
    private readonly roles: RolePermissionService,
  ) {}

  /** Cost and value figures are shown only to roles allowed to see inventory reports. */
  private async canSeeCost(t: TenantContext): Promise<boolean> {
    const p = await this.roles.get(t.roleId);
    return p.isOwner || p.keys.has('report.inventory');
  }

  @Get('balances')
  @RequirePermission('stock.read')
  @ApiOperation({
    summary: 'Stock per product in this branch (lowStock=true for the low-stock list)',
  })
  async balances(@Tenant() t: TenantContext, @Query() q: BalancesQuery) {
    return this.queries.balances(t, q, await this.canSeeCost(t));
  }

  @Get('balances/:productId')
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'One product: balance, batches with expiry status, recent movements' })
  async productStock(
    @Tenant() t: TenantContext,
    @Param('productId', new ParseUUIDPipe()) productId: string,
  ) {
    return this.queries.productStock(t, productId, await this.canSeeCost(t));
  }

  @Get('movements')
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'Stock movement history (append-only), newest first' })
  async movements(@Tenant() t: TenantContext, @Query() q: MovementsQuery) {
    return this.queries.movements(t, q, await this.canSeeCost(t));
  }

  @Get('expiring')
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'Batches already expired or expiring within N days (default 30)' })
  expiring(@Tenant() t: TenantContext, @Query() q: ExpiringQuery) {
    return this.queries.expiring(t, q);
  }

  @Get('valuation')
  @RequirePermission('report.inventory')
  @ApiOperation({ summary: 'Stock value at moving weighted-average cost' })
  valuation(@Tenant() t: TenantContext) {
    return this.queries.valuation(t);
  }

  @Get('reconciliation')
  @RequirePermission('stock.adjust')
  @ApiOperation({
    summary: 'Checks that balances equal the sum of movements (empty lists = consistent)',
  })
  reconciliation(@Tenant() t: TenantContext) {
    return this.queries.reconciliation(t);
  }

  @Post('opening-stock')
  @RequirePermission('stock.adjust')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({
    summary: 'Record opening stock (before any other activity for the product in this branch)',
  })
  async openingStock(
    @Tenant() t: TenantContext,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: OpeningStockDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = this.idempotency.requireKey(rawKey);
    const { result, replayed } = await this.adjustments.openingStock(t, key, dto, meta(req));
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result;
  }

  @Post('adjustments')
  @RequirePermission('stock.adjust')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({
    summary: 'Adjust stock: damage, expiry, loss (negative) or found / count correction',
  })
  async adjust(
    @Tenant() t: TenantContext,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: StockAdjustmentDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = this.idempotency.requireKey(rawKey);
    const { result, replayed } = await this.adjustments.adjust(t, key, dto, meta(req));
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result;
  }
}
