import { Module } from '@nestjs/common';
import { ContextController } from './context.controller';

@Module({ controllers: [ContextController] })
export class ContextModule {}
