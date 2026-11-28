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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CursorPage } from '../../../common/pagination/paginated';
import { CurrentAdmin, PlatformRoles, PlatformRoute } from '../platform.decorators';
import { platformMeta, type PlatformPrincipal, type PlatformRequest } from '../platform.types';
import { UpdateShopUserDto, UserReasonDto, UsersQuery, UserStatusDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('Platform: users')
@ApiBearerAuth()
@PlatformRoute()
@Controller('admin/v1')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get('users')
  @ApiOperation({ summary: 'Every person in every shop (search, filter by shop, role, status)' })
  async list(@Query() q: UsersQuery) {
    const page = await this.users.list(q);
    return new CursorPage(page.rows, page.meta);
  }

  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get('shops/:orgId/roles')
  @ApiOperation({ summary: 'Roles of one shop (to pick a new role for a user)' })
  roles(@Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.users.rolesOf(orgId);
  }

  @PlatformRoles('ADMIN')
  @Patch('users/:memberId')
  @ApiOperation({ summary: 'Edit name, phone, email or role (reason required; ADMIN only)' })
  update(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UpdateShopUserDto,
    @Req() req: PlatformRequest,
  ) {
    return this.users.update(a, memberId, dto, platformMeta(req));
  }

  @PlatformRoles('ADMIN')
  @HttpCode(200)
  @Post('users/:memberId/status')
  @ApiOperation({
    summary: 'Remove a user from the shop (DEACTIVATED) or bring them back (ACTIVE)',
  })
  status(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UserStatusDto,
    @Req() req: PlatformRequest,
  ) {
    return this.users.setStatus(a, memberId, dto.status, dto.reason, platformMeta(req));
  }

  @PlatformRoles('ADMIN', 'SUPPORT')
  @HttpCode(200)
  @Post('users/:memberId/force-logout')
  @ApiOperation({ summary: 'Sign this person out of the shop on every phone' })
  forceLogout(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UserReasonDto,
    @Req() req: PlatformRequest,
  ) {
    return this.users.forceLogout(a, memberId, dto.reason, platformMeta(req));
  }

  @PlatformRoles('ADMIN')
  @HttpCode(200)
  @Post('users/:memberId/reset-password')
  @ApiOperation({ summary: 'Temporary password (returned once); signs them out everywhere' })
  resetPassword(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('memberId', ParseUUIDPipe) memberId: string,
    @Body() dto: UserReasonDto,
    @Req() req: PlatformRequest,
  ) {
    return this.users.resetPassword(a, memberId, dto.reason, platformMeta(req));
  }
}
