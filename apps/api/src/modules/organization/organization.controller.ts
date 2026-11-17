import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { AppRequest, TenantContext } from '../../common/auth/auth.types';
import { RequirePermission, Tenant } from '../../common/auth/decorators';
import { RolePermissionService } from '../../common/auth/role-permission.service';
import { CreateBranchDto, UpdateBranchDto, UpdateOrganizationDto } from './organization.dto';
import { BranchService } from './branch.service';
import { OrganizationService } from './organization.service';

const meta = (req: AppRequest) => ({ correlationId: req.id, ipAddress: req.ip });

@ApiTags('Organization')
@ApiBearerAuth()
@ApiSecurity('branch')
@Controller()
export class OrganizationController {
  constructor(
    private readonly orgs: OrganizationService,
    private readonly branches: BranchService,
    private readonly roles: RolePermissionService,
  ) {}

  @Get('organization')
  @RequirePermission('organization.read')
  @ApiOperation({ summary: 'Shop settings' })
  getOrganization(@Tenant() t: TenantContext) {
    return this.orgs.get(t.organizationId);
  }

  @Patch('organization')
  @RequirePermission('organization.manage')
  @ApiOperation({ summary: 'Update shop, GST and discount settings' })
  updateOrganization(
    @Tenant() t: TenantContext,
    @Body() dto: UpdateOrganizationDto,
    @Req() req: AppRequest,
  ) {
    return this.orgs.update(t.organizationId, t.userId, dto, meta(req));
  }

  @Get('branches')
  @RequirePermission('branch.read')
  @ApiOperation({ summary: 'Branches (all for managers, assigned ones otherwise)' })
  async listBranches(@Tenant() t: TenantContext) {
    const perms = await this.roles.get(t.roleId);
    return this.branches.list(
      t.organizationId,
      t.memberId,
      perms.isOwner || perms.keys.has('branch.manage'),
    );
  }

  @Post('branches')
  @RequirePermission('branch.manage')
  @ApiOperation({
    summary: 'Create a branch (cash register and number series are created automatically)',
  })
  createBranch(@Tenant() t: TenantContext, @Body() dto: CreateBranchDto, @Req() req: AppRequest) {
    return this.branches.create(t.organizationId, t.userId, dto, meta(req));
  }

  @Patch('branches/:id')
  @RequirePermission('branch.manage')
  @ApiOperation({ summary: 'Update a branch' })
  updateBranch(
    @Tenant() t: TenantContext,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateBranchDto,
    @Req() req: AppRequest,
  ) {
    return this.branches.update(t.organizationId, t.userId, id, dto, meta(req));
  }
}
