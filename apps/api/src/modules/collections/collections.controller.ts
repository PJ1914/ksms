import {
  ReconcileThrottled,
  ReconciliationRunner,
} from '../../common/reconcile/reconciliation-runner';
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
import { RolePermissionService } from '../../common/auth/role-permission.service';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { CollectionAgentsService } from './collection-agents.service';
import {
  AgentSummaryQuery,
  AssignCustomerDto,
  CollectionAgentsQuery,
  CollectionsQuery,
  CreateCollectionAgentDto,
  CreateCollectionDto,
  CustomerPaymentDto,
  ReverseCollectionDto,
  UpdateCollectionAgentDto,
} from './collections.dto';
import { CollectionsReconciliationService } from './collections-reconciliation.service';
import { CollectionsService } from './collections.service';

const meta = (req: AppRequest) => ({ correlationId: req.id, ipAddress: req.ip });
const uuid = () => new ParseUUIDPipe();
const IDEMPOTENCY_DOC = {
  name: 'Idempotency-Key',
  required: true,
  description: 'UUID generated once per payment/reversal; retries and double taps reuse it',
};

@ApiTags('Collections')
@ApiBearerAuth()
@ApiSecurity('branch')
@RequireBranch()
@Controller()
export class CollectionsController {
  constructor(
    private readonly collections: CollectionsService,
    private readonly reconciliation: CollectionsReconciliationService,
    private readonly runner: ReconciliationRunner,
    private readonly idempotency: IdempotencyService,
    private readonly rolePerms: RolePermissionService,
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

  /** Owner and anyone with collection.assign may record a collection under another agent. */
  private async canAttributeOthers(t: TenantContext): Promise<boolean> {
    const p = await this.rolePerms.get(t.roleId);
    return p.isOwner || p.keys.has('collection.assign');
  }

  @Post('customers/:id/payments')
  @RequirePermission('collection.create')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({ summary: 'Record a customer khata payment and issue a numbered receipt' })
  async recordCustomerPayment(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) customerId: string,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CustomerPaymentDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const others = await this.canAttributeOthers(t);
    return this.idempotent(rawKey, res, (key) =>
      this.collections.recordPayment(
        t,
        customerId,
        key,
        dto,
        meta(req),
        'POST /customers/:id/payments',
        others,
      ),
    );
  }

  @Post('collections')
  @RequirePermission('collection.create')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({ summary: 'Record a collection payment for a customer' })
  async createCollection(
    @Tenant() t: TenantContext,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: CreateCollectionDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { customerId, ...rest } = dto;
    const others = await this.canAttributeOthers(t);
    return this.idempotent(rawKey, res, (key) =>
      this.collections.recordPayment(
        t,
        customerId,
        key,
        rest,
        meta(req),
        'POST /collections',
        others,
      ),
    );
  }

  @Get('collections')
  @RequirePermission('collection.read')
  @ApiOperation({ summary: 'List customer collection receipts for the active branch' })
  list(@Tenant() t: TenantContext, @Query() q: CollectionsQuery) {
    return this.collections.list(t, q);
  }

  @Get('collections/reconciliation')
  @ReconcileThrottled()
  @RequirePermission('system.reconcile')
  @ApiOperation({ summary: 'Verify customer balances, ledger entries, cashbook and records match' })
  reconcile(@Tenant() t: TenantContext) {
    return this.runner.run('collections', t.organizationId, t.branchId, (db) =>
      this.reconciliation.reconcile(t.organizationId, t.branchId ?? undefined, db),
    );
  }

  @Get('collections/:id')
  @RequirePermission('collection.read')
  @ApiOperation({ summary: 'Get a single collection receipt' })
  get(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.collections.get(t, id);
  }

  @Post('collections/:id/reverse')
  @HttpCode(200)
  @RequirePermission('collection.assign')
  @ApiHeader(IDEMPOTENCY_DOC)
  @ApiOperation({
    summary:
      'Reverse a collection (audit reason required). Needs collection.assign: a collector cannot undo receipts',
  })
  reverse(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Headers(IDEMPOTENCY_HEADER) rawKey: string | undefined,
    @Body() dto: ReverseCollectionDto,
    @Req() req: AppRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.idempotent(rawKey, res, (key) =>
      this.collections.reverse(t, id, key, dto, meta(req)),
    );
  }
}

@ApiTags('Collection Agents')
@ApiBearerAuth()
@ApiSecurity('branch')
@Controller('collection-agents')
export class CollectionAgentsController {
  constructor(private readonly agents: CollectionAgentsService) {}

  @Get()
  @RequirePermission('collection.read')
  @ApiOperation({ summary: 'List collection agents in the shop' })
  list(@Tenant() t: TenantContext, @Query() q: CollectionAgentsQuery) {
    return this.agents.list(t.organizationId, q);
  }

  @Post()
  @RequirePermission('collection.assign')
  @ApiOperation({ summary: 'Create a collection agent (optionally linked to a user login)' })
  create(
    @Tenant() t: TenantContext,
    @Body() dto: CreateCollectionAgentDto,
    @Req() req: AppRequest,
  ) {
    return this.agents.create(t, dto, meta(req));
  }

  @Get(':id')
  @RequirePermission('collection.read')
  @ApiOperation({ summary: 'Get collection agent details, active assignments and recent receipts' })
  get(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.agents.get(t.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission('collection.assign')
  @ApiOperation({ summary: 'Update a collection agent' })
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateCollectionAgentDto,
    @Req() req: AppRequest,
  ) {
    return this.agents.update(t, id, dto, meta(req));
  }

  @Post(':id/assignments')
  @RequirePermission('collection.assign')
  @ApiOperation({ summary: 'Assign a customer to a collection agent' })
  assign(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: AssignCustomerDto,
    @Req() req: AppRequest,
  ) {
    return this.agents.assignCustomer(t, id, dto, meta(req));
  }

  @Post(':id/assignments/:assignmentId/end')
  @HttpCode(200)
  @RequirePermission('collection.assign')
  @ApiOperation({ summary: 'End an active customer assignment for a collection agent' })
  endAssignment(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Param('assignmentId', uuid()) assignmentId: string,
    @Req() req: AppRequest,
  ) {
    return this.agents.endAssignment(t, id, assignmentId, meta(req));
  }

  @Get(':id/summary')
  @RequirePermission('collection.read')
  @ApiOperation({ summary: 'Collection agent summary (assigned outstanding and collected totals)' })
  summary(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Query() q: AgentSummaryQuery,
  ) {
    return this.agents.summary(t.organizationId, id, q);
  }
}
