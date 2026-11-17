import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import {
  CancelPurchaseDto,
  CreatePurchaseDto,
  CreatePurchaseReturnDto,
  PurchasesQuery,
  ReceivePurchaseDto,
  ReturnsQuery,
  UpdatePurchaseDto,
} from './procurement.dto';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchasesService } from './purchases.service';

const meta = (req: AppRequest) => ({ correlationId: req.id, ipAddress: req.ip });
const uuid = () => new ParseUUIDPipe();
const IDEMPOTENCY_DOC = {
  name: 'Idempotency-Key',
  required: true,
  description: 'UUID generated once per user action; retries reuse it',
};

@ApiTags('Purchases')
@ApiBearerAuth()
@ApiSecurity('branch')
@RequireBranch() // purchases and returns always belong to one branch
@Controller()
export class PurchasesController {
  constructor(
    private readonly purchases: PurchasesService,
    private readonly returns: PurchaseReturnsService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('purchases')
  @RequirePermission('purchase.read')
  @ApiOperation({
    summary:
      'Purchases of this branch (paginated). unpaid=true lists received purchases still owed',
  })
  list(@Tenant() t: TenantContext, @Query() q: PurchasesQuery) {
    return this.purchases.list(t, q);
  }

  @Get('purchases/:id')
  @RequirePermission('purchase.read')
  @ApiOperation({
    summary: 'One purchase with items, received quantities, payments and amount outstanding',
  })
  get(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.purchases.get(t, id);
  }

  @Post('purchases')
  @RequirePermission('purchase.create')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({
    summary:
      'Create a purchase (draft). receiveNow=true also receives the goods and posts the payable',
  })
  async create(
    @Tenant() t: TenantContext,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CreatePurchaseDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = this.idempotency.requireKey(rawKey);
    const { result, replayed } = await this.purchases.create(t, key, dto, meta(req));
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result;
  }

  @Patch('purchases/:id')
  @RequirePermission('purchase.create')
  @ApiOperation({ summary: 'Edit a draft purchase (sending items replaces all lines)' })
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdatePurchaseDto,
    @Req() req: AppRequest,
  ) {
    return this.purchases.update(t, id, dto, meta(req));
  }

  @Post('purchases/:id/confirm')
  @HttpCode(200)
  @RequirePermission('purchase.create')
  @ApiOperation({ summary: 'Confirm a draft: the order is placed and can no longer be edited' })
  confirm(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Req() req: AppRequest) {
    return this.purchases.confirm(t, id, meta(req));
  }

  @Post('purchases/:id/receive')
  @HttpCode(201)
  @RequirePermission('purchase.create')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({
    summary:
      'Receive goods (all that is left, or chosen lines/quantities). Adds stock and what is owed',
  })
  async receive(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: ReceivePurchaseDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = this.idempotency.requireKey(rawKey);
    const { result, replayed } = await this.purchases.receive(t, key, id, dto, meta(req));
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result;
  }

  @Post('purchases/:id/cancel')
  @HttpCode(200)
  @RequirePermission('purchase.cancel')
  @ApiOperation({
    summary: 'Cancel an order nothing was received for (use a return once goods are in)',
  })
  cancel(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: CancelPurchaseDto,
    @Req() req: AppRequest,
  ) {
    return this.purchases.cancel(t, id, dto, meta(req));
  }

  @Get('purchase-returns')
  @RequirePermission('purchase.read')
  @ApiOperation({ summary: 'Goods returned to suppliers from this branch' })
  listReturns(@Tenant() t: TenantContext, @Query() q: ReturnsQuery) {
    return this.returns.list(t, q);
  }

  @Get('purchase-returns/:id')
  @RequirePermission('purchase.read')
  @ApiOperation({ summary: 'One purchase return' })
  getReturn(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.returns.get(t, id);
  }

  @Post('purchase-returns')
  @RequirePermission('purchase.cancel')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({
    summary:
      'Send received goods back to the supplier: removes stock and reduces what the shop owes',
  })
  async createReturn(
    @Tenant() t: TenantContext,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CreatePurchaseReturnDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = this.idempotency.requireKey(rawKey);
    const { result, replayed } = await this.returns.create(t, key, dto, meta(req));
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result;
  }
}
