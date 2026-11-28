import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CursorPage } from '../../../common/pagination/paginated';
import { CurrentAdmin, PlatformRoles, PlatformRoute } from '../platform.decorators';
import { platformMeta, type PlatformPrincipal, type PlatformRequest } from '../platform.types';
import { ShopNoteDto, ShopReasonDto, ShopsQuery } from './shops.dto';
import { ShopsService } from './shops.service';

@ApiTags('Platform: shops')
@ApiBearerAuth()
@PlatformRoute()
@Controller('admin/v1/shops')
export class ShopsController {
  constructor(private readonly shops: ShopsService) {}

  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get()
  @ApiOperation({
    summary: 'All shops with derived subscription state (search, filters, keyset paging)',
  })
  async list(@Query() q: ShopsQuery) {
    const page = await this.shops.list(q);
    return new CursorPage(page.rows, page.meta);
  }

  @PlatformRoles('ADMIN', 'SUPPORT')
  @Get(':orgId')
  @ApiOperation({
    summary: 'One shop: owner, branches, users, devices, subscription, history, usage',
  })
  detail(@CurrentAdmin() a: PlatformPrincipal, @Param('orgId', ParseUUIDPipe) orgId: string) {
    return this.shops.detail(orgId, a.role);
  }

  @PlatformRoles('ADMIN')
  @HttpCode(200)
  @Post(':orgId/lock')
  @ApiOperation({
    summary: 'Lock the shop: every session ends, every request is refused (ADMIN only)',
  })
  lock(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ShopReasonDto,
    @Req() req: PlatformRequest,
  ) {
    return this.shops.lock(a, orgId, dto.reason, platformMeta(req));
  }

  @PlatformRoles('ADMIN')
  @HttpCode(200)
  @Post(':orgId/unlock')
  @ApiOperation({ summary: 'Unlock the shop; subscription dates are unchanged (ADMIN only)' })
  unlock(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ShopReasonDto,
    @Req() req: PlatformRequest,
  ) {
    return this.shops.unlock(a, orgId, dto.reason, platformMeta(req));
  }

  @PlatformRoles('ADMIN', 'SUPPORT')
  @HttpCode(200)
  @Post(':orgId/force-logout')
  @ApiOperation({ summary: 'Sign every user of the shop out' })
  forceLogout(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ShopReasonDto,
    @Req() req: PlatformRequest,
  ) {
    return this.shops.forceLogout(a, orgId, dto.reason, platformMeta(req));
  }

  @PlatformRoles('ADMIN', 'SUPPORT')
  @HttpCode(200)
  @Post(':orgId/devices/:deviceId/revoke')
  @ApiOperation({ summary: 'Block one phone of the shop and end its sessions (stolen phone)' })
  revokeDevice(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: ShopReasonDto,
    @Req() req: PlatformRequest,
  ) {
    return this.shops.revokeDevice(a, orgId, deviceId, dto.reason, platformMeta(req));
  }

  @PlatformRoles('ADMIN')
  @HttpCode(200)
  @Post(':orgId/reset-owner-password')
  @ApiOperation({
    summary: 'Give the owner a temporary password (returned once); signs them out (ADMIN only)',
  })
  resetOwnerPassword(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ShopReasonDto,
    @Req() req: PlatformRequest,
  ) {
    return this.shops.resetOwnerPassword(a, orgId, dto.reason, platformMeta(req));
  }

  @PlatformRoles('ADMIN', 'SUPPORT')
  @HttpCode(200)
  @Post(':orgId/notes')
  @ApiOperation({
    summary: 'Internal note on the shop (e.g. SUPPORT recommends a lock); kept in the audit log',
  })
  addNote(
    @CurrentAdmin() a: PlatformPrincipal,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body() dto: ShopNoteDto,
    @Req() req: PlatformRequest,
  ) {
    return this.shops.addNote(a, orgId, dto.note, platformMeta(req));
  }
}
