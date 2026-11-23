import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

// Decimal strings only: money and quantities never travel as JSON numbers.
const MONEY = /^\d{1,11}(\.\d{1,2})?$/;
const QTY = /^\d{1,11}(\.\d{1,3})?$/;
const FACTOR = /^\d{1,12}(\.\d{1,6})?$/;
const RATE = /^\d{1,3}(\.\d{1,4})?$/;
const msg = (what: string) => ({ message: `${what} must be a non-negative decimal string` });

const trim = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const upper = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  );

export const SKU_REGEX = /^[A-Z0-9][A-Z0-9._-]{1,39}$/;
export const BARCODE_REGEX = /^[A-Za-z0-9._-]{3,64}$/;

export class UnitConversionInputDto {
  @IsUUID() unitId!: string;
  /** Required for packaging units (1 BAG = 25 KG); optional for standard units (derived, and must agree). */
  @IsOptional() @Matches(FACTOR, msg('factorToBase')) factorToBase?: string;
  @IsOptional() @IsBoolean() isPurchaseUnit?: boolean;
  @IsOptional() @IsBoolean() isSaleUnit?: boolean;
}

export class PricePointInputDto {
  @IsUUID() unitId!: string;
  /** How many of the unit the price is for; default 1 ("500" + G = price of 500 g). */
  @IsOptional() @Matches(QTY, msg('quantity')) quantity?: string;
  @Matches(MONEY, msg('price')) price!: string;
  @IsOptional() @IsString() @MaxLength(40) label?: string;
}

export class CreateProductDto {
  @trim() @IsString() @Length(2, 150) name!: string;
  @IsOptional() @trim() @IsString() @MaxLength(150) localName?: string;
  /** Leave empty to have a unique SKU generated. */
  @IsOptional()
  @upper()
  @Matches(SKU_REGEX, { message: 'sku must be 2-40 chars: A-Z, 0-9, ., _ or -' })
  sku?: string;
  @IsIn(['WEIGHT', 'VOLUME', 'COUNT']) type!: 'WEIGHT' | 'VOLUME' | 'COUNT';
  @IsUUID() baseUnitId!: string;
  @IsOptional() @IsUUID() categoryId?: string;
  /** When true and categoryId is omitted, infers and creates/links a matching category from the product name. */
  @IsOptional() @IsBoolean() autoCategorize?: boolean;
  @IsOptional() @Matches(MONEY, msg('mrp')) mrp?: string;
  @IsOptional() @Matches(QTY, msg('minStockLevel')) minStockLevel?: string;
  @IsOptional() @Matches(QTY, msg('minSaleIncrement')) minSaleIncrement?: string;
  @IsOptional() @IsBoolean() allowFractional?: boolean;
  @IsOptional() @IsBoolean() trackBatch?: boolean;
  @IsOptional() @IsBoolean() trackExpiry?: boolean;
  @IsOptional() @IsBoolean() isTaxable?: boolean;
  @IsOptional() @Matches(/^\d{4,8}$/, { message: 'hsnCode must be 4-8 digits' }) hsnCode?: string;
  @IsOptional() @Matches(RATE, msg('gstRatePercent')) gstRatePercent?: string;
  @IsOptional() @IsIn(['INCLUSIVE', 'EXCLUSIVE']) taxMode?: 'INCLUSIVE' | 'EXCLUSIVE';
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @Matches(BARCODE_REGEX, { each: true, message: 'barcode must be 3-64 letters, digits, . _ -' })
  barcodes?: string[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => UnitConversionInputDto)
  conversions?: UnitConversionInputDto[];
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => PricePointInputDto)
  prices?: PricePointInputDto[];
}

/** type and baseUnitId are deliberately NOT editable: they define what every stock quantity means. */
export class UpdateProductDto {
  @IsOptional() @trim() @IsString() @Length(2, 150) name?: string;
  @IsOptional() @trim() @IsString() @MaxLength(150) localName?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() categoryId?: string | null;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'DISCONTINUED']) status?:
    'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  @IsOptional() @ValidateIf((_, v) => v !== null) @Matches(MONEY, msg('mrp')) mrp?: string | null;
  @IsOptional() @Matches(QTY, msg('minStockLevel')) minStockLevel?: string;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(QTY, msg('minSaleIncrement'))
  minSaleIncrement?: string | null;
  @IsOptional() @IsBoolean() allowFractional?: boolean;
  @IsOptional() @IsBoolean() trackBatch?: boolean;
  @IsOptional() @IsBoolean() trackExpiry?: boolean;
  @IsOptional() @IsBoolean() isTaxable?: boolean;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{4,8}$/, { message: 'hsnCode must be 4-8 digits' })
  hsnCode?: string | null;
  @IsOptional()
  @ValidateIf((_, v) => v !== null)
  @Matches(RATE, msg('gstRatePercent'))
  gstRatePercent?: string | null;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsIn(['INCLUSIVE', 'EXCLUSIVE']) taxMode?:
    'INCLUSIVE' | 'EXCLUSIVE' | null;
  /** Send the version you loaded; a stale value is refused (409) so two devices cannot overwrite each other. */
  @IsOptional() @IsInt() @Min(1) version?: number;
}

export class ListProductsQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
  /** Matches name, SKU or the start of a barcode. */
  @IsOptional() @trim() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'DISCONTINUED']) status?:
    'ACTIVE' | 'INACTIVE' | 'DISCONTINUED';
  @IsOptional() @IsIn(['WEIGHT', 'VOLUME', 'COUNT']) type?: 'WEIGHT' | 'VOLUME' | 'COUNT';
  @IsOptional() @IsIn(['name', 'sku', 'createdAt', 'updatedAt']) sort?:
    'name' | 'sku' | 'createdAt' | 'updatedAt';
  @IsOptional() @IsIn(['asc', 'desc']) order?: 'asc' | 'desc';
  /** Delta sync: only products changed after this instant. */
  @IsOptional() @IsDateString() updatedSince?: string;
}

export class AddConversionDto extends UnitConversionInputDto {}

export class UpdateConversionDto {
  @IsOptional() @Matches(FACTOR, msg('factorToBase')) factorToBase?: string;
  @IsOptional() @IsBoolean() isPurchaseUnit?: boolean;
  @IsOptional() @IsBoolean() isSaleUnit?: boolean;
}

export class ReplacePricesDto {
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => PricePointInputDto)
  prices!: PricePointInputDto[];
}

export class AddBarcodeDto {
  @Matches(BARCODE_REGEX, { message: 'barcode must be 3-64 letters, digits, . _ -' })
  barcode!: string;
  @IsOptional() @IsUUID() unitId?: string;
}

export class QuoteQuery {
  @IsUUID() unitId!: string;
  @Matches(QTY, msg('quantity')) quantity!: string;
}

export class CreateCategoryDto {
  @trim() @IsString() @Length(2, 60) name!: string;
  @IsOptional() @IsUUID() parentId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

export class UpdateCategoryDto {
  @IsOptional() @trim() @IsString() @Length(2, 60) name?: string;
  @IsOptional() @ValidateIf((_, v) => v !== null) @IsUUID() parentId?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
