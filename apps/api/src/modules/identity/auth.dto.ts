import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { normalizeIndianPhone } from '@ksms/validation';
import { GSTIN_REGEX, STATE_CODE_REGEX } from '../organization/organization.dto';

const phone = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (normalizeIndianPhone(value) ?? value) : value,
  );
const lower = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
const PHONE_RULE = { message: 'phone must be a valid Indian mobile number' };

/** Optional device info sent by the mobile app on login-like calls. */
export class DeviceInfoDto {
  @IsString() @Length(8, 100) deviceUid!: string;
  @IsOptional() @IsString() @MaxLength(100) deviceName?: string;
  @IsOptional() @IsString() @MaxLength(30) appVersion?: string;
}

export class RegisterOwnerDto extends DeviceInfoDto {
  @IsString() @Length(2, 100) fullName!: string;
  @phone() @Matches(/^[6-9]\d{9}$/, PHONE_RULE) phone!: string;
  @IsOptional() @lower() @IsEmail() @MaxLength(150) email?: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsString() @Length(2, 100) shopName!: string;
  @IsOptional() @IsString() @Length(2, 100) branchName?: string;
  @IsOptional()
  @Matches(STATE_CODE_REGEX, { message: 'stateCode must be the 2-digit GST state code' })
  stateCode?: string;
  @IsOptional() @Matches(GSTIN_REGEX, { message: 'gstin is not a valid GSTIN' }) gstin?: string;
}

export class LoginDto extends DeviceInfoDto {
  /** Mobile number or email. */
  @IsString() @Length(3, 150) identifier!: string;
  @IsString() @MinLength(1) @MaxLength(128) password!: string;
  /** Needed only when the same login belongs to several organizations. */
  @IsOptional() @IsUUID() organizationId?: string;
}

export class RefreshDto {
  @IsString() @Length(20, 200) refreshToken!: string;
}

export class ChangePasswordDto {
  @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
  @IsString() @MinLength(8) @MaxLength(128) newPassword!: string;
}

export class AcceptInvitationDto extends DeviceInfoDto {
  @IsString() @Length(8, 20) code!: string;
  @IsString() @Length(2, 100) fullName!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}

export class UpdateDeviceDto {
  @IsOptional() @IsString() @MaxLength(4096) pushToken?: string;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(30) appVersion?: string;
}
