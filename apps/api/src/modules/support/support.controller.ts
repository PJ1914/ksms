import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '../../common/auth/auth.types';
import {
  AllowWhenLocked,
  AuthenticatedOnly,
  RequirePermission,
  Tenant,
} from '../../common/auth/decorators';
import { CallbackDto, CreateTicketDto, TicketListQuery, TicketReplyDto } from './support.dto';
import { SupportService } from './support.service';

/** Help for the shop (ADMIN_PANEL.md section 2.7). Every route works while the shop is locked. */
@ApiTags('Support')
@ApiBearerAuth()
@AllowWhenLocked()
@Controller('support')
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @AuthenticatedOnly()
  @Get('contact')
  @ApiOperation({ summary: 'Support phone, WhatsApp (with a ready link) and hours' })
  contact(@Tenant() t: TenantContext) {
    return this.support.contact(t);
  }

  @RequirePermission('support.create')
  @Post('tickets')
  @ApiOperation({ summary: 'Raise a ticket (10 per hour per shop)' })
  create(@Tenant() t: TenantContext, @Body() dto: CreateTicketDto) {
    return this.support.create(t, dto);
  }

  @RequirePermission('support.create')
  @Post('callback')
  @ApiOperation({ summary: 'Ask support to call back' })
  callback(@Tenant() t: TenantContext, @Body() dto: CallbackDto) {
    return this.support.callback(t, dto);
  }

  @RequirePermission('support.create')
  @Get('tickets')
  @ApiOperation({ summary: 'Your tickets (all of the shop with support.read)' })
  list(@Tenant() t: TenantContext, @Query() q: TicketListQuery) {
    return this.support.list(t, q);
  }

  @RequirePermission('support.create')
  @Get('tickets/:id')
  @ApiOperation({ summary: 'A ticket and its conversation' })
  get(@Tenant() t: TenantContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.support.get(t, id);
  }

  @RequirePermission('support.create')
  @Post('tickets/:id/messages')
  @ApiOperation({ summary: 'Reply; reopens a resolved ticket, refused on a closed one' })
  reply(
    @Tenant() t: TenantContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TicketReplyDto,
  ) {
    return this.support.reply(t, id, dto.body);
  }
}
