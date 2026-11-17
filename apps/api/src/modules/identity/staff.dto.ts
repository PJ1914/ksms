import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { ALL_PERMISSION_KEYS } from '@ksms/constants';
import { normalizeIndianPhone } from '@ksms/validation';

export class UpdateEmployeeDto {
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  branchIds?: string[];
}

export class DeactivateEmployeeDto {
  @IsOptional() @IsString() @MaxLength(200) reason?: string;
}

export class CreateRoleDto {
  @IsString() @Length(2, 40) name!: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsArray() @ArrayUnique() @IsIn(ALL_PERMISSION_KEYS, { each: true }) permissionKeys!: string[];
}

export class UpdateRoleDto {
  @IsOptional() @IsString() @Length(2, 40) name?: string;
  @IsOptional() @IsString() @MaxLength(200) description?: string;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(ALL_PERMISSION_KEYS, { each: true })
  permissionKeys?: string[];
}

export class CreateInvitationDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? (normalizeIndianPhone(value) ?? value) : value,
  )
  @Matches(/^[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone!: string;
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  email?: string;
  @IsUUID() roleId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  branchIds!: string[];
}
