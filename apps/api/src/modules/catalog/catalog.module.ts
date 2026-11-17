import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CategoriesService } from './categories.service';
import { ProductsService } from './products.service';
import { UnitsService } from './units.service';

@Module({
  controllers: [CatalogController],
  providers: [UnitsService, CategoriesService, ProductsService],
  exports: [UnitsService, CategoriesService, ProductsService],
})
export class CatalogModule {}
