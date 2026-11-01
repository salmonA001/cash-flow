import { Injectable } from '@nestjs/common';
import { Prisma } from '@cfe/database';
import type { AuthUser } from './decorators';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async log(user: AuthUser, action: string, entityType: string, entityId: string | null, metadata?: Prisma.InputJsonValue) {
    await this.prisma.auditLog.create({
      data: { organizationId: user.organizationId, actorUserId: user.id, action, entityType, entityId, metadata },
    });
  }
}
