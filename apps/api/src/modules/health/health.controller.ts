import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: process is up. Does not touch the database. */
  @Get()
  live() {
    return { data: { status: 'ok' } };
  }

  /** Readiness: database reachable. */
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { data: { status: 'ok', database: 'up' } };
    } catch {
      throw new ServiceUnavailableException({
        error: { code: 'DATABASE_UNAVAILABLE', message: 'Database is not reachable' },
      });
    }
  }
}
