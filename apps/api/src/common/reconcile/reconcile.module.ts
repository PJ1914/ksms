import { Global, Module } from '@nestjs/common';
import { ReconciliationRunner } from './reconciliation-runner';

@Global()
@Module({ providers: [ReconciliationRunner], exports: [ReconciliationRunner] })
export class ReconcileModule {}
