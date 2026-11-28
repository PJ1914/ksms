import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PLATFORM_PASSWORD_MIN_LENGTH } from './credentials';

export class PlatformLoginDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password!: string;
}

export class MfaTokenDto {
  @ApiProperty({ description: 'mfaToken from /auth/login' })
  @IsString()
  @MaxLength(2000)
  mfaToken!: string;
}

export class MfaConfirmDto extends MfaTokenDto {
  @ApiProperty({ example: '123456' }) @Matches(/^\d{6}$/) code!: string;
}

export class MfaVerifyDto extends MfaTokenDto {
  @ApiPropertyOptional({ example: '123456' }) @IsOptional() @Matches(/^\d{6}$/) code?: string;
  @ApiPropertyOptional({ example: 'ABCDE-FGHIJ' })
  @IsOptional()
  @IsString()
  @Length(10, 16)
  recoveryCode?: string;
}

export class PlatformRefreshDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(200) refreshToken!: string;
}

export class PlatformChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) currentPassword!: string;
  @ApiProperty({ minLength: PLATFORM_PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PLATFORM_PASSWORD_MIN_LENGTH)
  @MaxLength(128)
  newPassword!: string;
}
