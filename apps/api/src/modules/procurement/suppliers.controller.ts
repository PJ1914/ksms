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
  CreateSupplierDto,
  LedgerQuery,
  PaymentsQuery,
  ReversePaymentDto,
  SupplierPaymentDto,
  SuppliersQuery,
  UpdateSupplierDto,
} from './procurement.dto';
import { ProcurementReconciliationService } from './procurement-reconciliation.service';
import { SupplierPaymentsService } from './supplier-payments.service';
import { SuppliersService } from './suppliers.service';

const meta = (req: AppRequest) => ({ correlationId: req.id, ipAddress: req.ip });
const uuid = () => new ParseUUIDPipe();
const IDEMPOTENCY_DOC = {
  name: 'Idempotency-Key',
  required: true,
  description: 'UUID generated once per user action; retries reuse it',
};

@ApiTags('Suppliers')
@ApiBearerAuth()
@ApiSecurity('branch')
@Controller()
export class SuppliersController {
  constructor(
    private readonly suppliers: SuppliersService,
    private readonly payments: SupplierPaymentsService,
    private readonly reconciliation: ProcurementReconciliationService,
    private readonly idempotency: IdempotencyService,
  ) {}

  @Get('suppliers')
  @RequirePermission('supplier.read')
  @ApiOperation({
    summary: 'Search suppliers (paginated). owed=true lists those the shop owes money to',
  })
  list(@Tenant() t: TenantContext, @Query() q: SuppliersQuery) {
    return this.suppliers.list(t.organizationId, q);
  }

  @Post('suppliers')
  @RequirePermission('supplier.manage')
  @ApiOperation({
    summary: 'Add a supplier. openingBalance (what is already owed) needs the X-Branch-Id header',
  })
  create(@Tenant() t: TenantContext, @Body() dto: CreateSupplierDto, @Req() req: AppRequest) {
    return this.suppliers.create(t, dto, meta(req));
  }

  @Get('suppliers/:id')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'One supplier with the balance owed and unpaid purchases' })
  get(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.suppliers.get(t.organizationId, id);
  }

  @Patch('suppliers/:id')
  @RequirePermission('supplier.manage')
  @ApiOperation({
    summary: 'Edit a supplier; send the version you loaded to avoid overwriting another device',
  })
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateSupplierDto,
    @Req() req: AppRequest,
  ) {
    return this.suppliers.update(t, id, dto, meta(req));
  }

  @Post('suppliers/:id/deactivate')
  @HttpCode(200)
  @RequirePermission('supplier.manage')
  @ApiOperation({ summary: 'Switch a supplier off (no new purchases); history is kept' })
  deactivate(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Req() req: AppRequest) {
    return this.suppliers.setActive(t, id, false, meta(req));
  }

  @Post('suppliers/:id/reactivate')
  @HttpCode(200)
  @RequirePermission('supplier.manage')
  @ApiOperation({ summary: 'Switch a supplier back on' })
  reactivate(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Req() req: AppRequest) {
    return this.suppliers.setActive(t, id, true, meta(req));
  }

  @Get('suppliers/:id/ledger')
  @RequirePermission('supplier.read')
  @ApiOperation({
    summary: 'Supplier statement: every change to what is owed, with the running balance',
  })
  statement(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Query() q: LedgerQuery) {
    return this.suppliers.statement(t.organizationId, id, q);
  }

  @Post('suppliers/:id/payments')
  @RequireBranch()
  @RequirePermission('supplier.payment')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({
    summary:
      'Pay a supplier. Settles the oldest unpaid purchases first, or the ones you choose; extra is an advance',
  })
  async pay(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: SupplierPaymentDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = this.idempotency.requireKey(rawKey);
    const { result, replayed } = await this.payments.pay(t, id, key, dto, meta(req));
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result;
  }

  @Get('supplier-payments')
  @RequirePermission('supplier.read')
  @ApiOperation({ summary: 'Payments made to suppliers, newest first' })
  listPayments(@Tenant() t: TenantContext, @Query() q: PaymentsQuery) {
    return this.payments.list(t, q);
  }

  @Post('supplier-payments/:id/reverse')
  @HttpCode(201)
  @RequirePermission('supplier.payment')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({
    summary: 'Undo a payment recorded by mistake (adds an opposite entry; nothing is deleted)',
  })
  async reverse(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: ReversePaymentDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const key = this.idempotency.requireKey(rawKey);
    const { result, replayed } = await this.payments.reverse(t, id, key, dto, meta(req));
    if (replayed) res.setHeader('Idempotent-Replayed', 'true');
    return result;
  }

  @Get('procurement/reconciliation')
  @RequirePermission('supplier.read')
  @ApiOperation({
    summary: 'Checks that stock, purchases, returns, payments and supplier balances all agree',
  })
  reconcile(@Tenant() t: TenantContext) {
    return this.reconciliation.run(t);
  }
}
