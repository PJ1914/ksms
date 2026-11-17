import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthGuard } from './common/auth/auth.guard';
import { AuthModule } from './common/auth/auth.module';
import { loggerOptions } from './common/logging/logger.config';
import { TenantGuard } from './common/tenant/tenant.guard';
import { ConfigModule, ENV, type Env } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { ContextModule } from './modules/context/context.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRootAsync({ inject: [ENV], useFactory: (env: Env) => loggerOptions(env) }),
    ThrottlerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => [{ ttl: env.THROTTLE_TTL_MS, limit: env.THROTTLE_LIMIT }],
    }),
    DatabaseModule,
    AuthModule,
    HealthModule,
    ContextModule,
  ],
  providers: [
    // Guard order matters: rate limit -> authenticate -> tenant context.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
  ],
})
export class AppModule {}
