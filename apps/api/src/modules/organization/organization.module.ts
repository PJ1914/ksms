import { Module } from '@nestjs/common';
import { BranchService } from './branch.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
  controllers: [OrganizationController],
  providers: [OrganizationService, BranchService],
  exports: [OrganizationService, BranchService],
})
export class OrganizationModule {}
