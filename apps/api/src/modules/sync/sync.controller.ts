import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { TenantContext } from '../../common/auth/auth.types';
import { RequirePermission, Tenant } from '../../common/auth/decorators';
import { SyncFeedQuery } from './sync.dto';
import { SyncService } from './sync.service';

@ApiTags('Sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly sync: SyncService) {}

  @Get('products')
  @RequirePermission('product.read')
  @ApiOperation({
    summary:
      'Delta feed of products (with conversions, prices, barcodes and soft deletes) ordered by (updated_at, id)',
  })
  products(@Tenant() t: TenantContext, @Query() q: SyncFeedQuery) {
    return this.sync.products(t.organizationId, q);
  }

  @Get('categories')
  @RequirePermission('product.read')
  @ApiOperation({
    summary:
      'Delta feed of product categories (including soft deletes) ordered by (updated_at, id)',
  })
  categories(@Tenant() t: TenantContext, @Query() q: SyncFeedQuery) {
    return this.sync.categories(t.organizationId, q);
  }

  @Get('units')
  @RequirePermission('product.read')
  @ApiOperation({
    summary: 'Stable-cursor feed of global units of measurement ordered by id',
  })
  units(@Query() q: SyncFeedQuery) {
    return this.sync.units(q);
  }

  @Get('customers')
  @RequirePermission('customer.read')
  @ApiOperation({
    summary: 'Delta feed of customers (including soft deletes) ordered by (updated_at, id)',
  })
  customers(@Tenant() t: TenantContext, @Query() q: SyncFeedQuery) {
    return this.sync.customers(t.organizationId, q);
  }
}
