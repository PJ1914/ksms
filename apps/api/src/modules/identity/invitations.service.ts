import { Injectable } from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type { TenantContext } from '../../common/auth/auth.types';
import { AppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchService } from '../organization/branch.service';
import type { AcceptInvitationDto } from './auth.dto';
import { AuthService, type RequestMeta } from './auth.service';
import { PasswordService } from './password.service';
import { RolesService } from './roles.service';
import { SessionService, sha256 } from './session.service';
import type { CreateInvitationDto } from './staff.dto';

const INVITE_TTL_MS = 72 * 3_600_000;
// No 0/O/1/I/L so codes can be read out over the phone.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const INVALID = () =>
  new AppException('INVITATION_INVALID', 'This invitation is invalid or has expired', 400);

const normalizeCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
const generateCode = (): string =>
  Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
const formatCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;

interface Meta {
  correlationId?: string;
  ipAddress?: string;
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branches: BranchService,
    private readonly roles: RolesService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly auth: AuthService,
  ) {}

  /** The plain code is returned ONCE here and never stored (only its hash is). */
  async create(t: TenantContext, dto: CreateInvitationDto, meta: Meta) {
    const target = await this.roles.keysOfRole(this.prisma, t.organizationId, dto.roleId);
    if (target.isOwnerRole) {
      throw new AppException('OWNER_ROLE_NOT_ASSIGNABLE', 'The Owner role cannot be assigned', 400);
    }
    await this.roles.assertCanGrant(this.prisma, t.roleId, target.keys);
    await this.branches.assertAssignable(this.prisma, t.organizationId, dto.branchIds);

    const existing = await this.prisma.organizationMember.findFirst({
      where: { organizationId: t.organizationId, user: { phone: dto.phone } },
      select: { id: true },
    });
    if (existing)
      throw new AppException('ALREADY_MEMBER', 'This person already works in your shop', 409);

    const code = generateCode();
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const invitation = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invitation.create({
        data: {
          organizationId: t.organizationId,
          phone: dto.phone,
          email: dto.email,
          roleId: dto.roleId,
          branchIds: dto.branchIds,
          codeHash: sha256(code),
          expiresAt,
          createdById: t.userId,
        },
        select: { id: true },
      });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        actorId: t.userId,
        action: 'invitation.create',
        entityType: 'invitation',
        entityId: inv.id,
        after: { phone: dto.phone, roleId: dto.roleId, branchIds: dto.branchIds },
        ...meta,
      });
      return inv;
    });
    return { id: invitation.id, code: formatCode(code), phone: dto.phone, expiresAt };
  }

  async list(organizationId: string) {
    const rows = await this.prisma.invitation.findMany({
      where: { organizationId },
      select: {
        id: true,
        phone: true,
        email: true,
        branchIds: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
        role: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const now = Date.now();
    return rows.map((r) => ({
      ...r,
      status: r.acceptedAt
        ? 'ACCEPTED'
        : r.revokedAt
          ? 'REVOKED'
          : r.expiresAt.getTime() <= now
            ? 'EXPIRED'
            : 'PENDING',
    }));
  }

  async revoke(t: TenantContext, id: string, meta: Meta): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invitation.findFirst({
        where: { id, organizationId: t.organizationId },
        select: { acceptedAt: true },
      });
      if (!inv) throw new AppException('NOT_FOUND', 'Invitation not found', 404);
      if (inv.acceptedAt)
        throw new AppException(
          'INVITATION_ALREADY_USED',
          'This invitation was already accepted',
          409,
        );
      await tx.invitation.update({ where: { id }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        organizationId: t.organizationId,
        actorId: t.userId,
        action: 'invitation.revoke',
        entityType: 'invitation',
        entityId: id,
        ...meta,
      });
    });
  }

  /** Public: join a shop with a code. Existing accounts must prove ownership with their password. */
  async accept(dto: AcceptInvitationDto, meta: RequestMeta) {
    const codeHash = sha256(normalizeCode(dto.code));
    const preview = await this.prisma.invitation.findUnique({
      where: { codeHash },
      select: { phone: true },
    });
    if (!preview) throw INVALID();

    const existingUser = await this.prisma.user.findUnique({
      where: { phone: preview.phone },
      select: { id: true, passwordHash: true, isActive: true },
    });
    if (existingUser) {
      const ok = await this.passwords.verify(existingUser.passwordHash, dto.password);
      if (!ok || !existingUser.isActive)
        throw new AppException('INVALID_CREDENTIALS', 'Incorrect password for this account', 401);
    }
    const passwordHash = existingUser
      ? existingUser.passwordHash
      : await this.passwords.hash(dto.password);

    const result = await this.prisma.$transaction(async (tx) => {
      const inv = await tx.invitation.findUnique({
        where: { codeHash },
        select: {
          id: true,
          organizationId: true,
          phone: true,
          email: true,
          roleId: true,
          branchIds: true,
          expiresAt: true,
          acceptedAt: true,
          revokedAt: true,
        },
      });
      if (!inv || inv.acceptedAt || inv.revokedAt || inv.expiresAt.getTime() <= Date.now())
        throw INVALID();

      // Claim atomically: only one concurrent acceptance can win.
      const claimed = await tx.invitation.updateMany({
        where: { id: inv.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count !== 1) throw INVALID();

      const role = await tx.role.findFirst({
        where: { id: inv.roleId, organizationId: inv.organizationId },
        select: { id: true },
      });
      const validBranches = await tx.branch.findMany({
        where: {
          id: { in: inv.branchIds },
          organizationId: inv.organizationId,
          deletedAt: null,
          isActive: true,
        },
        select: { id: true },
      });
      if (!role || validBranches.length === 0) throw INVALID();

      const userId = existingUser
        ? existingUser.id
        : (
            await tx.user.create({
              data: { fullName: dto.fullName, phone: inv.phone, email: inv.email, passwordHash },
              select: { id: true },
            })
          ).id;

      const already = await tx.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: inv.organizationId, userId } },
        select: { id: true },
      });
      if (already) throw new AppException('ALREADY_MEMBER', 'You already belong to this shop', 409);

      const member = await tx.organizationMember.create({
        data: { organizationId: inv.organizationId, userId, roleId: role.id },
        select: { id: true },
      });
      await tx.branchMembership.createMany({
        data: validBranches.map((b, i) => ({
          organizationId: inv.organizationId,
          memberId: member.id,
          branchId: b.id,
          isDefault: i === 0,
        })),
      });
      const session = await this.sessions.create(tx, userId, inv.organizationId, meta);
      await this.audit.record(tx, {
        organizationId: inv.organizationId,
        actorId: userId,
        action: 'invitation.accept',
        entityType: 'invitation',
        entityId: inv.id,
        correlationId: meta.correlationId,
        ipAddress: meta.ipAddress,
      });
      return { userId, organizationId: inv.organizationId, ...session };
    });

    return this.auth.authResponse(
      result.userId,
      result.organizationId,
      result.sessionId,
      result.refreshToken,
    );
  }
}
