import { Global, Module } from '@nestjs/common';
import { AccessTokenService } from './access-token.service';
import { RolePermissionService } from './role-permission.service';
import { SessionCache } from './session-cache';

@Global()
@Module({
  providers: [AccessTokenService, RolePermissionService, SessionCache],
  exports: [AccessTokenService, RolePermissionService, SessionCache],
})
export class AuthModule {}
