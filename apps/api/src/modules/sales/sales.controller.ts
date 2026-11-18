import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
import { HeldBillsService } from './held-bills.service';
import { InvoicesService } from './invoices.service';
import { SaleCancellationService } from './sale-cancellation.service';
import { SaleReturnsService } from './sale-returns.service';
import {
  CancelSaleDto,
  CreateSaleDto,
  CreateSaleReturnDto,
  HeldBillDto,
  HeldBillsQuery,
  InvoicesQuery,
  PreviewSaleDto,
  ReturnsQuery,
  SalesQuery,
} from './sales.dto';
import { SalesReconciliationService } from './sales-reconciliation.service';
import { SalesService } from './sales.service';

const meta = (req: AppRequest) => ({ correlationId: req.id, ipAddress: req.ip });
const uuid = () => new ParseUUIDPipe();
const IDEMPOTENCY_DOC = {
  name: 'Idempotency-Key',
  required: true,
  description: 'UUID generated once per checkout / action; retries and double taps reuse it',
};

@ApiTags('Sales')
@ApiBearerAuth()
@ApiSecurity('branch')
@RequireBranch() // every bill belongs to one branch
@Controller()
export class SalesController {
  constructor(
    private readonly sales: SalesService,
    private readonly cancellations: SaleCancellationService,
    private readonly returns: SaleReturnsService,
    private readonly heldBills: HeldBillsService,
    private readonly invoices: InvoicesService,
    private readonly reconciliation: SalesReconciliationService,
    private readonly idempotency: IdempotencyService,
  ) {}

  private async idempotent<T>(
    rawKey: string | undefined,
    res: Response,
    work: (key: string) => Promise<{ result: T; replayed: boolean }>,
  ): Promise<T> {
    const key = this.idempotency.requireKey(rawKey);
    const { result, replayed } = await work(key);
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result;
  }

  @Post('sales')
  @RequirePermission('sale.create')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({
    summary:
      'Checkout: prices, discounts, stock, bill number, payments and credit in one transaction',
  })
  checkout(
    @Tenant() t: TenantContext,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CreateSaleDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.idempotent(rawKey, res, (key) => this.sales.checkout(t, key, dto, meta(req)));
  }

  @Post('sales/preview')
  @HttpCode(200)
  @RequirePermission('sale.create')
  @ApiOperation({
    summary:
      'Price a cart exactly as checkout would (same code), saving nothing. Warns about stock and credit limit',
  })
  preview(@Tenant() t: TenantContext, @Body() dto: PreviewSaleDto) {
    return this.sales.preview(t, dto);
  }

  @Get('sales/reconciliation')
  @RequirePermission('report.sales')
  @ApiOperation({
    summary: 'Checks that bills, stock, payments, cashbook and customer accounts all agree',
  })
  reconcile(@Tenant() t: TenantContext) {
    return this.reconciliation.run(t);
  }

  @Get('sales')
  @RequirePermission('sale.read')
  @ApiOperation({ summary: 'Bills of this branch, newest first (from/to are India-time days)' })
  list(@Tenant() t: TenantContext, @Query() q: SalesQuery) {
    return this.sales.list(t, q);
  }

  @Get('sales/:id')
  @RequirePermission('sale.read')
  @ApiOperation({ summary: 'One bill with its lines, payments and returns so far' })
  get(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.sales.get(t, id);
  }

  @Post('sales/:id/cancel')
  @HttpCode(200)
  @RequirePermission('sale.cancel')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({
    summary: 'Cancel a bill (same day; earlier days need the owner). Everything is reversed',
  })
  cancel(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CancelSaleDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.idempotent(rawKey, res, (key) =>
      this.cancellations.cancel(t, key, id, dto, meta(req)),
    );
  }

  @Post('sale-returns')
  @RequirePermission('sale.return')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({ summary: 'Goods brought back: refund as money or to the customer account' })
  createReturn(
    @Tenant() t: TenantContext,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CreateSaleReturnDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.idempotent(rawKey, res, (key) => this.returns.create(t, key, dto, meta(req)));
  }

  @Get('sale-returns')
  @RequirePermission('sale.read')
  @ApiOperation({ summary: 'Returns of this branch, newest first' })
  listReturns(@Tenant() t: TenantContext, @Query() q: ReturnsQuery) {
    return this.returns.list(t, q);
  }

  @Get('sale-returns/:id')
  @RequirePermission('sale.read')
  @ApiOperation({ summary: 'One return' })
  getReturn(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.returns.get(t, id);
  }

  // ----- held bills (no stock or money effect)

  @Get('held-bills')
  @RequirePermission('sale.create')
  @ApiOperation({ summary: 'Carts parked at the counter in this branch' })
  listHeld(@Tenant() t: TenantContext, @Query() q: HeldBillsQuery) {
    return this.heldBills.list(t, q);
  }

  @Post('held-bills')
  @RequirePermission('sale.create')
  @ApiOperation({ summary: 'Park a cart (never touches stock or money)' })
  hold(@Tenant() t: TenantContext, @Body() dto: HeldBillDto) {
    return this.heldBills.create(t, dto);
  }

  @Get('held-bills/:id')
  @RequirePermission('sale.create')
  getHeld(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.heldBills.get(t, id);
  }

  @Put('held-bills/:id')
  @RequirePermission('sale.create')
  @ApiOperation({ summary: 'Replace a parked cart' })
  updateHeld(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: HeldBillDto,
  ) {
    return this.heldBills.update(t, id, dto);
  }

  @Delete('held-bills/:id')
  @HttpCode(204)
  @RequirePermission('sale.create')
  @ApiOperation({ summary: 'Discard a parked cart' })
  async removeHeld(@Tenant() t: TenantContext, @Param('id', uuid()) id: string): Promise<void> {
    await this.heldBills.remove(t, id);
  }

  // ----- invoices (immutable snapshots and PDF)

  @Get('invoices')
  @RequirePermission('sale.read')
  @ApiOperation({ summary: 'Invoices of this branch, newest first' })
  listInvoices(@Tenant() t: TenantContext, @Query() q: InvoicesQuery) {
    return this.invoices.list(t, q);
  }

  @Get('invoices/:id')
  @RequirePermission('sale.read')
  @ApiOperation({ summary: 'One invoice with its immutable seller, buyer and tax snapshots' })
  getInvoice(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.invoices.get(t, id);
  }

  @Get('invoices/:id/pdf')
  @RequirePermission('sale.read')
  @ApiOperation({ summary: 'Download the invoice PDF rendered from its immutable snapshots' })
  async getInvoicePdf(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Res() res: Response,
  ) {
    const { filename, buffer } = await this.invoices.pdf(t, id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.end(buffer);
  }
}
