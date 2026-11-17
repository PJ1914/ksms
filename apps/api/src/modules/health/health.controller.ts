import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/decorators';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';

@ApiTags('Health')
@Public()
@SkipThrottle() // platform probes must never be rate limited
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness: the process is up (does not touch the database)' })
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness: the database answers a query' })
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', database: 'up' };
    } catch {
      throw new AppException('DATABASE_UNAVAILABLE', 'Database is not reachable', 503);
    }
  }
}
