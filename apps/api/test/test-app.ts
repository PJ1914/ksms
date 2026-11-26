import { Body, Controller, Get, INestApplication, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Test } from '@nestjs/testing';
import { IsInt, IsString, Length, Min } from 'class-validator';
import { Public, RequirePermission } from '../src/common/auth/decorators';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/common/configure-app';
import { parseEnv } from '../src/config/env';
import { PrismaService } from '../src/database/prisma.service';

export const ids = {
  user: '11111111-1111-4111-8111-111111111111',
  org: '22222222-2222-4222-8222-222222222222',
  otherOrg: '99999999-9999-4999-8999-999999999999',
  session: '33333333-3333-4333-8333-333333333333',
  branch: '44444444-4444-4444-8444-444444444444',
  otherBranch: '55555555-5555-4555-8555-555555555555',
  member: '66666666-6666-4666-8666-666666666666',
  role: '77777777-7777-4777-8777-777777777777',
};

export class EchoDto {
  @IsString()
  @Length(1, 20)
  name!: string;

  @IsInt()
  @Min(1)
  qty!: number;
}

/** Test-only routes used to exercise the global pipes, filters and guards. */
@Controller('test')
export class TestController {
  @Public()
  @Post('echo')
  echo(@Body() dto: EchoDto) {
    return dto;
  }

  @Public()
  @Get('ping')
  ping() {
    return { pong: true };
  }

  @Public()
  @Get('big')
  big() {
    return Array.from({ length: 200 }, (_, i) => ({ id: i, name: `Product number ${i}` }));
  }

  @Public()
  @Get('pdf')
  pdf(@Res() res: Response) {
    res.setHeader('Content-Type', 'application/pdf');
    res.send(Buffer.alloc(20_000, 'a'));
  }

  // Authenticated route that declares no permission policy: must be denied by default.
  @Get('no-policy')
  noPolicy() {
    return { reached: true };
  }

  @Post('no-policy')
  noPolicyWrite() {
    return { reached: true };
  }

  @RequirePermission('sale.create')
  @Get('needs-sale')
  needsSale() {
    return { reached: true };
  }

  @RequirePermission('sale.create', 'sale.cancel')
  @Get('needs-both')
  needsBoth() {
    return { reached: true };
  }

  @Public()
  @Get('boom')
  boom(): never {
    throw new Error('secret-db-password-leak');
  }

  @Public()
  @Get('duplicate')
  duplicate(): never {
    // shape of a Prisma unique-constraint error
    throw Object.assign(new Error('Unique constraint failed on the fields: (`sku`)'), {
      code: 'P2002',
    });
  }
}

export function createPrismaMock() {
  return {
    $queryRaw: jest.fn(),
    userSession: { findUnique: jest.fn() },
    organizationMember: { findUnique: jest.fn() },
    role: { findUnique: jest.fn() },
  };
}
export type PrismaMock = ReturnType<typeof createPrismaMock>;

export async function createTestApp(prisma: PrismaMock): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [TestController],
  })
    .overrideProvider(PrismaService)
    .useValue(prisma)
    .compile();
  const app = moduleRef.createNestApplication({ bufferLogs: true });
  configureApp(app, parseEnv());
  await app.init();
  return app;
}
