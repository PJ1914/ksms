import { Body, Controller, Get, HttpCode, Patch, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AppRequest, Principal, TenantContext } from '../../common/auth/auth.types';
import {
  AuthenticatedOnly,
  AuthThrottled,
  CurrentPrincipal,
  Public,
  Tenant,
} from '../../common/auth/decorators';
import { AuthService, type RequestMeta } from './auth.service';
import {
  AcceptInvitationDto,
  ChangePasswordDto,
  LoginDto,
  RefreshDto,
  RegisterOwnerDto,
  UpdateDeviceDto,
} from './auth.dto';
import { DevicesService } from './devices.service';
import { InvitationsService } from './invitations.service';

export const requestMeta = (req: AppRequest): RequestMeta => ({
  correlationId: req.id,
  ipAddress: req.ip,
  userAgent: req.headers['user-agent'],
});

@ApiTags('Auth')
@Controller()
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly invitations: InvitationsService,
    private readonly devices: DevicesService,
  ) {}

  @Public()
  @AuthThrottled()
  @Post('auth/register-owner')
  @ApiOperation({ summary: 'Create a shop and its owner account; returns a signed-in session' })
  registerOwner(@Body() dto: RegisterOwnerDto, @Req() req: AppRequest) {
    return this.auth.registerOwner(dto, { ...requestMeta(req), ...pickDevice(dto) });
  }

  @Public()
  @AuthThrottled()
  @HttpCode(200)
  @Post('auth/login')
  @ApiOperation({ summary: 'Sign in with mobile number or email and password' })
  login(@Body() dto: LoginDto, @Req() req: AppRequest) {
    return this.auth.login(dto, { ...requestMeta(req), ...pickDevice(dto) });
  }

  @Public()
  @AuthThrottled()
  @HttpCode(200)
  @Post('auth/refresh')
  @ApiOperation({ summary: 'Rotate the refresh token and get a new access token' })
  refresh(@Body() dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Public()
  @AuthThrottled()
  @Post('auth/accept-invitation')
  @ApiOperation({ summary: 'Join a shop using an invitation code; returns a signed-in session' })
  acceptInvitation(@Body() dto: AcceptInvitationDto, @Req() req: AppRequest) {
    return this.invitations.accept(dto, { ...requestMeta(req), ...pickDevice(dto) });
  }

  @ApiBearerAuth()
  @AuthenticatedOnly()
  @HttpCode(204)
  @Post('auth/logout')
  @ApiOperation({ summary: 'Revoke the current session' })
  async logout(@CurrentPrincipal() p: Principal): Promise<void> {
    await this.auth.logout(p.sessionId);
  }

  @ApiBearerAuth()
  @AuthenticatedOnly()
  @Get('auth/me')
  @ApiOperation({ summary: 'Current user, role, branches and permissions' })
  me(@Tenant() t: TenantContext) {
    return this.auth.me(t.userId, t.organizationId);
  }

  @ApiBearerAuth()
  @AuthenticatedOnly()
  @HttpCode(204)
  @Post('auth/change-password')
  @ApiOperation({ summary: 'Change password; signs the user out of every device' })
  async changePassword(
    @Tenant() t: TenantContext,
    @Body() dto: ChangePasswordDto,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.auth.changePassword(t.userId, t.organizationId, dto, requestMeta(req));
  }

  @ApiBearerAuth()
  @AuthenticatedOnly()
  @Patch('devices/current')
  @ApiOperation({ summary: 'Update this device (push token, name, app version)' })
  updateDevice(@CurrentPrincipal() p: Principal, @Body() dto: UpdateDeviceDto) {
    return this.devices.updateCurrent(p, dto);
  }
}

function pickDevice(dto: { deviceUid: string; deviceName?: string; appVersion?: string }) {
  return { deviceUid: dto.deviceUid, deviceName: dto.deviceName, appVersion: dto.appVersion };
}
