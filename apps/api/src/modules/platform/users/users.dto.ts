import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';

export class UsersQuery {
  @ApiPropertyOptional({ description: 'Name, phone, email or shop name' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  q?: string;

  @ApiPropertyOptional({ description: 'Only this shop' }) @IsOptional() @IsUUID() orgId?: string;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'DEACTIVATED', 'INVITED'] })
  @IsOptional()
  @IsIn(['ACTIVE', 'DEACTIVATED', 'INVITED'])
  status?: 'ACTIVE' | 'DEACTIVATED' | 'INVITED';

  @ApiPropertyOptional({ example: 'Cashier', description: 'Role name (system or custom)' })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  role?: string;

  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) cursor?: string;

  @ApiPropertyOptional({ default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;
}

export class UpdateShopUserDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @Length(2, 100) fullName?: string;

  @ApiPropertyOptional({ example: '9876543210' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ description: 'Empty string clears it' })
  @ValidateIf((_, v) => v !== '')
  @IsOptional()
  @IsEmail()
  @MaxLength(254)
  email?: string;

  @ApiPropertyOptional({ description: 'Any role of the same shop' })
  @IsOptional()
  @IsUUID()
  roleId?: string;

  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class UserStatusDto {
  @ApiProperty({ enum: ['ACTIVE', 'DEACTIVATED'] })
  @IsIn(['ACTIVE', 'DEACTIVATED'])
  status!: 'ACTIVE' | 'DEACTIVATED';

  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}

export class UserReasonDto {
  @ApiProperty() @IsString() @Length(3, 500) reason!: string;
}
