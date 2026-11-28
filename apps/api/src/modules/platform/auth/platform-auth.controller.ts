import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AllowPendingPasswordChange,
  CurrentAdmin,
  PlatformPublic,
  PlatformRoles,
  PlatformRoute,
} from '../platform.decorators';
import { platformMeta, type PlatformPrincipal, type PlatformRequest } from '../platform.types';
import {
  MfaConfirmDto,
  MfaTokenDto,
  MfaVerifyDto,
  PlatformChangePasswordDto,
  PlatformLoginDto,
  PlatformRefreshDto,
} from './platform-auth.dto';
import { PlatformAuthService } from './platform-auth.service';

@ApiTags('Platform: auth')
@PlatformRoute()
@Controller('admin/v1')
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @PlatformPublic()
  @HttpCode(200)
  @Post('auth/login')
  @ApiOperation({
    summary: 'Email + password. Returns an mfaToken and the next step (MFA_VERIFY or MFA_SETUP).',
  })
  login(@Body() dto: PlatformLoginDto, @Req() req: PlatformRequest) {
    return this.auth.login(dto.email, dto.password, platformMeta(req));
  }

  @PlatformPublic()
  @HttpCode(200)
  @Post('auth/mfa/setup')
  @ApiOperation({
    summary: 'First sign-in: get the authenticator secret / otpauth link (show it as a QR code)',
  })
  mfaSetup(@Body() dto: MfaTokenDto) {
    return this.auth.mfaSetup(dto.mfaToken);
  }

  @PlatformPublic()
  @HttpCode(200)
  @Post('auth/mfa/confirm')
  @ApiOperation({
    summary: 'Finish enrolment with a first code; returns the session and 10 recovery codes (once)',
  })
  mfaConfirm(@Body() dto: MfaConfirmDto, @Req() req: PlatformRequest) {
    return this.auth.mfaConfirm(dto.mfaToken, dto.code, platformMeta(req));
  }

  @PlatformPublic()
  @HttpCode(200)
  @Post('auth/mfa/verify')
  @ApiOperation({
    summary: 'Second step: 6-digit authenticator code or a recovery code; returns the session',
  })
  mfaVerify(@Body() dto: MfaVerifyDto, @Req() req: PlatformRequest) {
    return this.auth.mfaVerify(dto.mfaToken, dto, platformMeta(req));
  }

  @PlatformPublic()
  @HttpCode(200)
  @Post('auth/refresh')
  @ApiOperation({ summary: 'Rotate the refresh token (30 min idle and 12 h absolute limits)' })
  refresh(@Body() dto: PlatformRefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @ApiBearerAuth()
  @PlatformRoles('ADMIN', 'SUPPORT')
  @AllowPendingPasswordChange()
  @HttpCode(204)
  @Post('auth/logout')
  @ApiOperation({ summary: 'End this admin session' })
  async logout(@CurrentAdmin() a: PlatformPrincipal, @Req() req: PlatformRequest): Promise<void> {
    await this.auth.logout(a.adminId, a.sessionId, platformMeta(req));
  }

  @ApiBearerAuth()
  @PlatformRoles('ADMIN', 'SUPPORT')
  @AllowPendingPasswordChange()
  @HttpCode(200)
  @Post('auth/change-password')
  @ApiOperation({
    summary: 'Change password (required after a temporary one); signs out other sessions',
  })
  changePassword(
    @CurrentAdmin() a: PlatformPrincipal,
    @Body() dto: PlatformChangePasswordDto,
    @Req() req: PlatformRequest,
  ) {
    return this.auth.changePassword(
      a.adminId,
      a.sessionId,
      dto.currentPassword,
      dto.newPassword,
      platformMeta(req),
    );
  }

  @ApiBearerAuth()
  @PlatformRoles('ADMIN', 'SUPPORT')
  @AllowPendingPasswordChange()
  @Get('me')
  @ApiOperation({ summary: 'The signed-in admin' })
  me(@CurrentAdmin() a: PlatformPrincipal) {
    return this.auth.me(a.adminId);
  }
}
