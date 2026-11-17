import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '../../common/auth/auth.types';
import { AuthenticatedOnly, Tenant } from '../../common/auth/decorators';

@ApiTags('Context')
@ApiBearerAuth()
@ApiSecurity('branch')
@AuthenticatedOnly()
@Controller('context')
export class ContextController {
  /** Who am I and where am I working? */
  @Get()
  @ApiOperation({ summary: 'Current user, organization and (optional) branch context' })
  get(@Tenant() tenant: TenantContext) {
    return {
      userId: tenant.userId,
      organizationId: tenant.organizationId,
      branchId: tenant.branchId,
      roleId: tenant.roleId,
    };
  }
}
