import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentAdmin, PlatformRoles, PlatformRoute } from '../platform.decorators';
import { platformMeta, type PlatformPrincipal, type PlatformRequest } from '../platform.types';
import { CreatePlatformAdminDto, ReasonDto, UpdatePlatformAdminDto } from './platform-admins.dto';
import { PlatformAdminsService } from './platform-admins.service';

@ApiTags('Platform: admins')
@ApiBearerAuth()
@PlatformRoute()
@PlatformRoles('ADMIN')
@Controller('admin/v1/admins')
export class PlatformAdminsController {
  constructor(private readonly admins: PlatformAdminsService) {}

  @Get()
  @ApiOperation({ summary: 'All platform admins and support users' })
  list() {
    return this.admins.list();
  }

  @Post()
  @ApiOperation({
    summary: 'Create an admin or support user; the temporary password is returned once',
  })
  create(
    @CurrentAdmin() a: PlatformPrincipal,
    @Body() dto: CreatePlatformAdminDto,
    @Req() req: PlatformRequest,
  ) {
    return this.admins.create(a, dto, platformMeta(req));
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change role or enable/disable (never the last active ADMIN, never yourself)',
  })
  update(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePlatformAdminDto,
    @Req() req: PlatformRequest,
  ) {
    return this.admins.update(a, id, dto, platformMeta(req));
  }

  @HttpCode(200)
  @Post(':id/reset-mfa')
  @ApiOperation({ summary: 'Clear the authenticator; the admin sets it up again at next sign-in' })
  resetMfa(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: PlatformRequest,
  ) {
    return this.admins.resetMfa(a, id, dto.reason, platformMeta(req));
  }

  @HttpCode(200)
  @Post(':id/reset-password')
  @ApiOperation({ summary: 'New temporary password (returned once); ends their sessions' })
  resetPassword(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReasonDto,
    @Req() req: PlatformRequest,
  ) {
    return this.admins.resetPassword(a, id, dto.reason, platformMeta(req));
  }
}
