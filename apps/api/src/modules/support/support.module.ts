import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/** Shop-side support tickets, callback requests and the support contact (ADMIN_PANEL.md Phase D). */
@Module({
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
