import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import type { AppRequest, TenantContext } from '../../common/auth/auth.types';
import { RequirePermission, Tenant } from '../../common/auth/decorators';
import { CategoriesService } from './categories.service';
import {
  AddBarcodeDto,
  AddConversionDto,
  CreateCategoryDto,
  CreateProductDto,
  ListProductsQuery,
  QuoteQuery,
  ReplacePricesDto,
  UpdateCategoryDto,
  UpdateConversionDto,
  UpdateProductDto,
} from './catalog.dto';
import { ProductsService } from './products.service';
import { UnitsService } from './units.service';

const meta = (req: AppRequest) => ({ correlationId: req.id, ipAddress: req.ip });
const uuid = () => new ParseUUIDPipe();

@ApiTags('Catalog')
@ApiBearerAuth()
@ApiSecurity('branch')
@Controller()
export class CatalogController {
  constructor(
    private readonly units: UnitsService,
    private readonly categories: CategoriesService,
    private readonly products: ProductsService,
  ) {}

  // ----- units -----
  @Get('units')
  @RequirePermission('product.read')
  @ApiOperation({
    summary:
      'Global unit list (KG, G, L, ML, PCS, BAG, ...). Packaging units are sized per product',
  })
  listUnits() {
    return this.units.list();
  }

  // ----- categories -----
  @Get('categories')
  @RequirePermission('product.read')
  listCategories(@Tenant() t: TenantContext) {
    return this.categories.list(t.organizationId);
  }

  @Post('categories')
  @RequirePermission('category.manage')
  createCategory(
    @Tenant() t: TenantContext,
    @Body() dto: CreateCategoryDto,
    @Req() req: AppRequest,
  ) {
    return this.categories.create(t.organizationId, t.userId, dto, meta(req));
  }

  @Patch('categories/:id')
  @RequirePermission('category.manage')
  updateCategory(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateCategoryDto,
    @Req() req: AppRequest,
  ) {
    return this.categories.update(t.organizationId, t.userId, id, dto, meta(req));
  }

  @Delete('categories/:id')
  @HttpCode(204)
  @RequirePermission('category.manage')
  async deleteCategory(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.categories.remove(t.organizationId, t.userId, id, meta(req));
  }

  // ----- products -----
  @Get('products')
  @RequirePermission('product.read')
  @ApiOperation({
    summary: 'Search and filter products (paginated). q matches name, SKU or barcode prefix',
  })
  listProducts(@Tenant() t: TenantContext, @Query() q: ListProductsQuery) {
    return this.products.list(t.organizationId, q);
  }

  // Declared before ':id' so "by-barcode" is never mistaken for an id.
  @Get('products/by-barcode/:barcode')
  @RequirePermission('product.read')
  @ApiOperation({ summary: 'Look a product up from a scanned barcode' })
  byBarcode(@Tenant() t: TenantContext, @Param('barcode') barcode: string) {
    return this.products.getByBarcode(t.organizationId, barcode);
  }

  @Get('products/:id')
  @RequirePermission('product.read')
  getProduct(@Tenant() t: TenantContext, @Param('id', uuid()) id: string) {
    return this.products.get(t.organizationId, id);
  }

  @Get('products/:id/quote')
  @RequirePermission('product.read')
  @ApiOperation({
    summary:
      'Price and base-unit quantity for a quantity of a unit, using the real conversion rules',
  })
  quote(@Tenant() t: TenantContext, @Param('id', uuid()) id: string, @Query() q: QuoteQuery) {
    return this.products.quote(t.organizationId, id, q);
  }

  @Post('products')
  @RequirePermission('product.manage')
  @ApiOperation({
    summary: 'Create a product with its unit conversions, prices and barcodes in one step',
  })
  createProduct(@Tenant() t: TenantContext, @Body() dto: CreateProductDto, @Req() req: AppRequest) {
    return this.products.create(t.organizationId, t.userId, dto, meta(req));
  }

  @Patch('products/:id')
  @RequirePermission('product.manage')
  @ApiOperation({ summary: 'Edit a product. Type and base unit cannot change' })
  updateProduct(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: UpdateProductDto,
    @Req() req: AppRequest,
  ) {
    return this.products.update(t.organizationId, t.userId, id, dto, meta(req));
  }

  @Delete('products/:id')
  @HttpCode(204)
  @RequirePermission('product.manage')
  @ApiOperation({ summary: 'Delete a product that has no history; otherwise mark it DISCONTINUED' })
  async deleteProduct(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Req() req: AppRequest,
  ): Promise<void> {
    await this.products.remove(t.organizationId, t.userId, id, meta(req));
  }

  // ----- conversions -----
  @Post('products/:id/conversions')
  @RequirePermission('product.manage')
  addConversion(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: AddConversionDto,
    @Req() req: AppRequest,
  ) {
    return this.products.addConversion(t.organizationId, t.userId, id, dto, meta(req));
  }

  @Patch('products/:id/conversions/:unitId')
  @RequirePermission('product.manage')
  @ApiOperation({
    summary:
      'Change a unit factor or flags. Already-written purchases and sales keep their own factor snapshot',
  })
  updateConversion(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Param('unitId', uuid()) unitId: string,
    @Body() dto: UpdateConversionDto,
    @Req() req: AppRequest,
  ) {
    return this.products.updateConversion(t.organizationId, t.userId, id, unitId, dto, meta(req));
  }

  @Delete('products/:id/conversions/:unitId')
  @RequirePermission('product.manage')
  removeConversion(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Param('unitId', uuid()) unitId: string,
    @Req() req: AppRequest,
  ) {
    return this.products.removeConversion(t.organizationId, t.userId, id, unitId, meta(req));
  }

  // ----- prices -----
  @Put('products/:id/prices')
  @RequirePermission('product.manage')
  @ApiOperation({ summary: 'Replace the whole price list (e.g. 500 g = 30, 1 kg = 58)' })
  replacePrices(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: ReplacePricesDto,
    @Req() req: AppRequest,
  ) {
    return this.products.replacePrices(t.organizationId, t.userId, id, dto.prices, meta(req));
  }

  // ----- barcodes -----
  @Post('products/:id/barcodes')
  @RequirePermission('product.manage')
  addBarcode(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Body() dto: AddBarcodeDto,
    @Req() req: AppRequest,
  ) {
    return this.products.addBarcode(t.organizationId, t.userId, id, dto, meta(req));
  }

  @Delete('products/:id/barcodes/:barcodeId')
  @RequirePermission('product.manage')
  removeBarcode(
    @Tenant() t: TenantContext,
    @Param('id', uuid()) id: string,
    @Param('barcodeId', uuid()) barcodeId: string,
    @Req() req: AppRequest,
  ) {
    return this.products.removeBarcode(t.organizationId, t.userId, id, barcodeId, meta(req));
  }
}
