import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import argon2 from 'argon2';
import { PrismaService } from '../common/prisma.service';

export const ACCESS_TTL_SECONDS = 15 * 60;
export const REFRESH_TTL_MS = 14 * 24 * 60 * 60 * 1000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');


export interface IssuedSession {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  /** Real hash verified for unknown emails so response time does not reveal which emails exist. */
  private readonly dummyHash = argon2.hash(randomBytes(16).toString('hex'), { type: argon2.argon2id });

  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string }): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    const valid = await argon2.verify(user?.passwordHash ?? (await this.dummyHash), password);
    if (!user || !valid || !user.isActive) throw new UnauthorizedException('Invalid email or password');
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.issue(user.id, user.organizationId, meta);
  }

  /** Rotates the refresh token. Reuse of a revoked token revokes every session of that user. */
  async refresh(refreshToken: string, meta: { ip?: string; userAgent?: string }): Promise<IssuedSession> {
    const session = await this.prisma.refreshSession.findUnique({ where: { tokenHash: hash(refreshToken) }, include: { user: true } });
    if (!session) throw new UnauthorizedException('Invalid session');
    if (session.revokedAt) {
      await this.prisma.refreshSession.updateMany({ where: { userId: session.userId, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new UnauthorizedException('Session reuse detected; all sessions revoked');
    }
    if (session.expiresAt < new Date() || !session.user.isActive) throw new UnauthorizedException('Session expired');
    await this.prisma.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    return this.issue(session.userId, session.user.organizationId, meta);
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (!refreshToken) return;
    await this.prisma.refreshSession.updateMany({ where: { tokenHash: hash(refreshToken), revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async issue(userId: string, organizationId: string, meta: { ip?: string; userAgent?: string }): Promise<IssuedSession> {
    const refreshToken = randomBytes(32).toString('base64url');
    await this.prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: hash(refreshToken),
        expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
        ip: meta.ip,
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });
    const accessToken = await this.jwt.signAsync({ sub: userId, org: organizationId }, { expiresIn: ACCESS_TTL_SECONDS });
    return { accessToken, refreshToken };
  }
}
