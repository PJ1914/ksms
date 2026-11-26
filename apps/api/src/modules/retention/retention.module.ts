import { Module } from '@nestjs/common';
import { ConfigModule } from '../../config/config.module';
import { DatabaseModule } from '../../database/database.module';
import { RetentionService } from './retention.service';

/** Standalone module for the scheduled purge job: database only, no HTTP, guards or other modules. */
@Module({
  imports: [ConfigModule, DatabaseModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
