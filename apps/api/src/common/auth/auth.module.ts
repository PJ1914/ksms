import { Global, Module } from '@nestjs/common';
import { AccessTokenService } from './access-token.service';
import { RolePermissionService } from './role-permission.service';

@Global()
@Module({
  providers: [AccessTokenService, RolePermissionService],
  exports: [AccessTokenService, RolePermissionService],
})
export class AuthModule {}
