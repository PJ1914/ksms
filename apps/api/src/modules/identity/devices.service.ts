import { Injectable } from '@nestjs/common';
import type { Principal } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import type { UpdateDeviceDto } from './auth.dto';

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService) {}

  /** Updates the device attached to the caller's own session (users can never touch other devices). */
  async updateCurrent(principal: Principal, dto: UpdateDeviceDto) {
    const session = await this.prisma.userSession.findUnique({
      where: { id: principal.sessionId },
      select: { deviceId: true },
    });
    if (!session?.deviceId)
      throw new AppException('NOT_FOUND', 'This session has no registered device', 404);
    return this.prisma.device.update({
      where: { id: session.deviceId },
      data: {
        pushToken: dto.pushToken,
        name: dto.name,
        appVersion: dto.appVersion,
        lastSeenAt: new Date(),
      },
      select: {
        id: true,
        deviceUid: true,
        name: true,
        platform: true,
        appVersion: true,
        lastSeenAt: true,
      },
    });
  }
}
