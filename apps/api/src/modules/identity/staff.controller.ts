import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { AppRequest, TenantContext } from '../../common/auth/auth.types';
import { RequirePermission, Tenant } from '../../common/auth/decorators';
import { DevicesService } from './devices.service';
import { EmployeesService } from './employees.service';
import { InvitationsService } from './invitations.service';
import { RolesService } from './roles.service';
import {
  CreateInvitationDto,
  CreateRoleDto,
  DeactivateEmployeeDto,
  UpdateEmployeeDto,
  UpdateRoleDto,
} from './staff.dto';

const meta = (req: AppRequest) => ({ correlationId: req.id, ipAddress: req.ip });
const uuid = () => new ParseUUIDPipe();

@ApiTags('Employees')
@ApiBearerAuth()
@ApiSecurity('branch')
@Controller('employees')
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  @RequirePermission('employee.read')
  @ApiOperation({ summary: 'List employees of the shop' })
  list(@Tenant() t: TenantContext) {
    return this.employees.list(t.organizationId);
  }

  @Get(':id')
  @RequirePermission('employee.read')
  get(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.employees.get(t.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission('employee.manage')
  @ApiOperation({ summary: "Change an employee's role and/or branch assignments" })
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateEmployeeDto,
    @Req() req: AppRequest,
  ) {
    return this.employees.update(t, id, dto, meta(req));
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @RequirePermission('employee.manage')
  @ApiOperation({ summary: 'Deactivate an employee and sign them out immediately' })
  deactivate(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: DeactivateEmployeeDto,
    @Req() req: AppRequest,
  ) {
    return this.employees.deactivate(t, id, dto.reason, meta(req));
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @RequirePermission('employee.manage')
  reactivate(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Req() req: AppRequest) {
    return this.employees.reactivate(t, id, meta(req));
  }
}

@ApiTags('Devices')
@ApiBearerAuth()
@Controller('devices')
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  @RequirePermission('employee.read')
  @ApiOperation({ summary: "List the shop's registered phones" })
  list(@Tenant() t: TenantContext) {
    return this.devices.list(t.organizationId);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermission('employee.manage')
  @ApiOperation({ summary: 'Block a phone (lost or stolen); ends every session on it' })
  revoke(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Req() req: AppRequest) {
    return this.devices.revoke(t, id, meta(req));
  }

  @Post(':id/restore')
  @HttpCode(200)
  @RequirePermission('employee.manage')
  @ApiOperation({ summary: 'Re-enable a blocked phone' })
  restore(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Req() req: AppRequest) {
    return this.devices.restore(t, id, meta(req));
  }

  @Post(':id/release')
  @HttpCode(200)
  @RequirePermission('employee.manage')
  @ApiOperation({ summary: 'Free a phone so a different user can sign in on it' })
  release(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Req() req: AppRequest) {
    return this.devices.release(t, id, meta(req));
  }
}

@ApiTags('Roles')
@ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions')
  @RequirePermission('role.read')
  @ApiOperation({ summary: 'The permission catalogue' })
  permissions() {
    return this.roles.permissionCatalog();
  }

  @Get('roles')
  @RequirePermission('role.read')
  list(@Tenant() t: TenantContext) {
    return this.roles.list(t.organizationId);
  }

  @Get('roles/:id')
  @RequirePermission('role.read')
  get(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.roles.get(t.organizationId, id);
  }

  @Post('roles')
  @RequirePermission('role.manage')
  @ApiOperation({ summary: 'Create a custom role (you can only grant permissions you hold)' })
  create(@Tenant() t: TenantContext, @Body() dto: CreateRoleDto, @Req() req: AppRequest) {
    return this.roles.create(t.organizationId, t.userId, t.roleId, dto, meta(req));
  }

  @Patch('roles/:id')
  @RequirePermission('role.manage')
  update(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateRoleDto,
    @Req() req: AppRequest,
  ) {
    return this.roles.update(t.organizationId, t.userId, t.roleId, id, dto, meta(req));
  }

  @Delete('roles/:id')
  @HttpCode(204)
  @RequirePermission('role.manage')
  async remove(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.roles.remove(t.organizationId, t.userId, id, meta(req));
  }
}

@ApiTags('Invitations')
@ApiBearerAuth()
@Controller('invitations')
export class InvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post()
  @RequirePermission('invitation.manage')
  @ApiOperation({
    summary: 'Invite an employee; the one-time code is returned only in this response',
  })
  create(@Tenant() t: TenantContext, @Body() dto: CreateInvitationDto, @Req() req: AppRequest) {
    return this.invitations.create(t, dto, meta(req));
  }

  @Get()
  @RequirePermission('invitation.manage')
  list(@Tenant() t: TenantContext) {
    return this.invitations.list(t.organizationId);
  }

  @Post(':id/revoke')
  @HttpCode(204)
  @RequirePermission('invitation.manage')
  async revoke(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.invitations.revoke(t, id, meta(req));
  }
}
