import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AppException } from '../../common/errors/app.exception';
import type { Db } from '../../database/db.types';
import { PrismaService } from '../../database/prisma.service';
import type { UnitInfo } from './domain/units';

@Injectable()
export class UnitsService {
  constructor(private readonly prisma: PrismaService) {}

  async list() {
    const rows = await this.prisma.unitOfMeasurement.findMany({
      orderBy: [{ dimension: 'asc' }, { isPackaging: 'asc' }, { code: 'asc' }],
    });
    return rows.map((u) => ({
      id: u.id,
      code: u.code,
      name: u.name,
      dimension: u.dimension,
      isPackaging: u.isPackaging,
      standardFactor: u.standardFactor ? u.standardFactor.toFixed() : null,
    }));
  }

  /** Loads units for the domain engine. Unknown ids raise UNIT_NOT_FOUND. */
  async load(db: Db, ids: string[]): Promise<Map<string, UnitInfo>> {
    const unique = [...new Set(ids)];
    const rows = await db.unitOfMeasurement.findMany({ where: { id: { in: unique } } });
    if (rows.length !== unique.length)
      throw new AppException('UNIT_NOT_FOUND', 'One or more units do not exist', 404);
    return new Map(
      rows.map((u) => [
        u.id,
        {
          id: u.id,
          code: u.code,
          dimension: u.dimension,
          isPackaging: u.isPackaging,
          standardFactor: u.standardFactor ? new Decimal(u.standardFactor.toString()) : null,
        },
      ]),
    );
  }
}
