import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { PLATFORM_ROLES, type PlatformRoleName } from '@ksms/constants';

export class CreatePlatformAdminDto {
  @ApiProperty() @IsEmail() @MaxLength(254) email!: string;
  @ApiProperty() @IsString() @Length(2, 100) fullName!: string;
  @ApiProperty({ enum: PLATFORM_ROLES }) @IsIn(PLATFORM_ROLES) role!: PlatformRoleName;
}

/** Why an admin was changed: required, and kept in the audit log. */
export class ReasonDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class UpdatePlatformAdminDto extends ReasonDto {
  @ApiPropertyOptional({ enum: PLATFORM_ROLES })
  @IsOptional()
  @IsIn(PLATFORM_ROLES)
  role?: PlatformRoleName;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
