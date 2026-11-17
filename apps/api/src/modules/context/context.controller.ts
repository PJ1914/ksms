import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '../../common/auth/auth.types';
import { Tenant } from '../../common/auth/decorators';

@ApiTags('Context')
@ApiBearerAuth()
@ApiSecurity('branch')
@Controller('context')
export class ContextController {
  /** Who am I and where am I working? The mobile app calls this on start-up. */
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
