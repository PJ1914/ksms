import { Module } from '@nestjs/common';
import { SubscriptionModule } from '../subscription/subscription.module';
import { BranchService } from './branch.service';
import { OrganizationController } from './organization.controller';
import { OrganizationService } from './organization.service';

@Module({
  imports: [SubscriptionModule],
  controllers: [OrganizationController],
  providers: [OrganizationService, BranchService],
  exports: [OrganizationService, BranchService],
})
export class OrganizationModule {}
