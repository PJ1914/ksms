import type { PrismaService } from '../../database/prisma.service';

/** The membership row the tenant guard needs (member, role, and the branches still usable). */
export function findMember(prisma: PrismaService, organizationId: string, userId: string) {
  return prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId } },
    select: {
      id: true,
      roleId: true,
      status: true,
      // A branch that was switched off or deleted can no longer be worked in.
      branches: {
        where: { branch: { deletedAt: null, isActive: true } },
        select: { branchId: true },
      },
    },
  });
}

export type MemberLookup = ReturnType<typeof findMember>;
