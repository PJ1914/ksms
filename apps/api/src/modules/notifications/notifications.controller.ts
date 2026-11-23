import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '../../common/auth/auth.types';
import {
  AuthenticatedOnly,
  RequireBranch,
  RequirePermission,
  Tenant,
} from '../../common/auth/decorators';
import { NotificationsQuery } from './notifications.dto';
import { NotificationsService } from './notifications.service';

const uuid = () => new ParseUUIDPipe();

@ApiTags('Notifications')
@ApiBearerAuth()
@ApiSecurity('branch')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'List notifications for this user and working branch' })
  list(@Tenant() t: TenantContext, @Query() q: NotificationsQuery) {
    return this.notifications.list(t, q);
  }

  @Get('unread-count')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Unread notification count for this user and working branch' })
  unreadCount(@Tenant() t: TenantContext) {
    return this.notifications.unreadCount(t);
  }

  @Post(':id/read')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Mark a notification as read' })
  markRead(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.notifications.markRead(t, id);
  }

  @Post('read-all')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Mark all unread notifications as read' })
  markAllRead(@Tenant() t: TenantContext) {
    return this.notifications.markAllRead(t);
  }

  @Post('check-alerts')
  @HttpCode(200)
  @RequireBranch()
  @RequirePermission('stock.read')
  @ApiOperation({
    summary: 'Scan working branch for low stock & expiring batches and raise alerts',
  })
  checkAlerts(@Tenant() t: TenantContext) {
    return this.notifications.checkBranchAlerts(t);
  }
}
