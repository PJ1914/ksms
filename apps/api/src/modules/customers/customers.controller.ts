import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { AppRequest, TenantContext } from '../../common/auth/auth.types';
import { RequirePermission, Tenant } from '../../common/auth/decorators';
import {
  CreateCustomerDto,
  CustomerLedgerQuery,
  CustomersQuery,
  UpdateCustomerDto,
} from './customers.dto';
import { CustomersService } from './customers.service';

const meta = (req: AppRequest) => ({ correlationId: req.id, ipAddress: req.ip });
const uuid = () => new ParseUUIDPipe();

@ApiTags('Customers')
@ApiBearerAuth()
@ApiSecurity('branch')
@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermission('customer.read')
  @ApiOperation({
    summary:
      'Search customers by name, mobile number or GSTIN. owes=true lists those who owe money',
  })
  list(@Tenant() t: TenantContext, @Query() q: CustomersQuery) {
    return this.customers.list(t.organizationId, q);
  }

  @Post()
  @RequirePermission('customer.manage')
  @ApiOperation({
    summary: 'Add a customer (mobile number unique in the shop); creditLimit is optional',
  })
  create(@Tenant() t: TenantContext, @Body() dto: CreateCustomerDto, @Req() req: AppRequest) {
    return this.customers.create(t, dto, meta(req));
  }

  @Get(':id')
  @RequirePermission('customer.read')
  @ApiOperation({ summary: 'One customer with what they owe' })
  get(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.customers.get(t.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission('customer.manage')
  @ApiOperation({ summary: 'Edit a customer; send the version you loaded' })
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateCustomerDto,
    @Req() req: AppRequest,
  ) {
    return this.customers.update(t, id, dto, meta(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('customer.manage')
  @ApiOperation({ summary: 'Switch a customer off (no new credit); history is kept' })
  deactivate(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Req() req: AppRequest) {
    return this.customers.setActive(t, id, false, meta(req));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('customer.manage')
  @ApiOperation({ summary: 'Switch a customer back on' })
  reactivate(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Req() req: AppRequest) {
    return this.customers.setActive(t, id, true, meta(req));
  }

  @Get(':id/ledger')
  @RequirePermission('ledger.read')
  @ApiOperation({
    summary: 'Khata: every change to what the customer owes, with the running balance',
  })
  statement(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Query() q: CustomerLedgerQuery,
  ) {
    return this.customers.statement(t.organizationId, id, q);
  }
}
