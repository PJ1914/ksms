import { Global, Module } from '@nestjs/common';
import { Env, parseEnv } from './env';

/** Injection token for the validated environment. */
export const ENV = Symbol('ENV');
export type { Env };

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => parseEnv() }],
  exports: [ENV],
})
export class ConfigModule {}
