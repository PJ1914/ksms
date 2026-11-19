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
import { CashbookQueryService } from './cashbook-query.service';
import { DailyClosingService } from './daily-closing.service';
import { ExpensesService } from './expenses.service';
import { FinanceReconciliationService } from './finance-reconciliation.service';
import {
  CancelExpenseDto,
  CashbookAdjustmentDto,
  CashbookQuery,
  CloseDayDto,
  ClosingPreviewQuery,
  ClosingsQuery,
  CreateExpenseCategoryDto,
  CreateExpenseDto,
  ExpensesQuery,
  UpdateExpenseCategoryDto,
} from './finance.dto';

const meta = (req: AppRequest) => ({ correlationId: req.id, ipAddress: req.ip });
const uuid = () => new ParseUUIDPipe();
const IDEMPOTENCY_DOC = {
  name: 'Idempotency-Key',
  required: true,
  description: 'UUID generated once per financial write; retries and double taps reuse it',
};

@ApiTags('Finance')
@ApiBearerAuth()
@ApiSecurity('branch')
@Controller()
export class FinanceController {
  constructor(
    private readonly expenses: ExpensesService,
    private readonly cashbook: CashbookQueryService,
    private readonly closings: DailyClosingService,
    private readonly reconciliation: FinanceReconciliationService,
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

  // ---------------------------------------------------------------- expense categories

  @Get('expense-categories')
  @RequirePermission('expense.read')
  @ApiOperation({ summary: 'List expense categories in the shop' })
  listCategories(@Tenant() t: TenantContext, @Query('activeOnly') activeOnly?: string) {
    return this.expenses.listCategories(t.organizationId, activeOnly === 'true');
  }

  @Post('expense-categories')
  @RequirePermission('expense.create')
  @ApiOperation({ summary: 'Create an expense category' })
  createCategory(
    @Tenant() t: TenantContext,
    @Body() dto: CreateExpenseCategoryDto,
    @Req() req: AppRequest,
  ) {
    return this.expenses.createCategory(t, dto, meta(req));
  }

  @Patch('expense-categories/:id')
  @RequirePermission('expense.create')
  @ApiOperation({ summary: 'Update or toggle an expense category' })
  updateCategory(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateExpenseCategoryDto,
    @Req() req: AppRequest,
  ) {
    return this.expenses.updateCategory(t, id, dto, meta(req));
  }

  // ---------------------------------------------------------------- expenses

  @Get('expenses')
  @RequireBranch()
  @RequirePermission('expense.read')
  @ApiOperation({ summary: 'List branch expenses' })
  listExpenses(@Tenant() t: TenantContext, @Query() q: ExpensesQuery) {
    return this.expenses.list(t, q);
  }

  @Post('expenses')
  @RequireBranch()
  @RequirePermission('expense.create')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({ summary: 'Record a branch expense and write a cashbook entry' })
  createExpense(
    @Tenant() t: TenantContext,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CreateExpenseDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.idempotent(rawKey, res, (key) => this.expenses.create(t, key, dto, meta(req)));
  }

  @Post('expenses/:id/cancel')
  @HttpCode(200)
  @RequireBranch()
  @RequirePermission('expense.create')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({ summary: 'Cancel an expense and write a reversing cashbook entry' })
  cancelExpense(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CancelExpenseDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.idempotent(rawKey, res, (key) => this.expenses.cancel(t, id, key, dto, meta(req)));
  }

  // ---------------------------------------------------------------- cashbook

  @Get('cashbook')
  @RequireBranch()
  @RequirePermission('cashbook.read')
  @ApiOperation({ summary: 'List branch cashbook entries with summary totals' })
  listCashbook(@Tenant() t: TenantContext, @Query() q: CashbookQuery) {
    return this.cashbook.list(t, q);
  }

  @Post('cashbook/entries')
  @RequireBranch()
  @RequirePermission('cashbook.manage')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({ summary: 'Record a manual CASH_IN or CASH_OUT cashbook adjustment' })
  recordAdjustment(
    @Tenant() t: TenantContext,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CashbookAdjustmentDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.idempotent(rawKey, res, (key) =>
      this.cashbook.recordAdjustment(t, key, dto, meta(req)),
    );
  }

  // ---------------------------------------------------------------- daily closing

  @Get('closings/preview')
  @RequireBranch()
  @RequirePermission('cashbook.read')
  @ApiOperation({
    summary: 'Preview opening, expected cash and payment totals for a business date',
  })
  previewClosing(@Tenant() t: TenantContext, @Query() q: ClosingPreviewQuery) {
    return this.closings.preview(t, q.businessDate);
  }

  @Get('closings')
  @RequireBranch()
  @RequirePermission('cashbook.read')
  @ApiOperation({ summary: 'List daily closings for the active branch' })
  listClosings(@Tenant() t: TenantContext, @Query() q: ClosingsQuery) {
    return this.closings.list(t, q);
  }

  @Post('closings')
  @RequireBranch()
  @RequirePermission('closing.manage')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({ summary: 'Perform daily cash closing for the active branch register' })
  closeDay(
    @Tenant() t: TenantContext,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CloseDayDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.idempotent(rawKey, res, (key) => this.closings.close(t, key, dto, meta(req)));
  }

  @Get('finance/reconciliation')
  @RequireBranch()
  @RequirePermission('cashbook.read')
  @ApiOperation({ summary: 'Verify expenses, cashbook entries and daily closings reconcile' })
  reconcile(@Tenant() t: TenantContext) {
    return this.reconciliation.reconcile(t.organizationId, t.branchId ?? undefined);
  }
}
