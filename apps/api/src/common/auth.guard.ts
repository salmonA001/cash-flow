import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { PermissionKey } from '@cfe/business-rules';
import type { Request } from 'express';
import { AuthUser, IS_PUBLIC, REQUIRED_PERMISSION } from './decorators';
import { PrismaService } from './prisma.service';

export const ACCESS_COOKIE = 'cfe_at';
export const REFRESH_COOKIE = 'cfe_rt';

export interface AccessTokenPayload {
  sub: string;
  org: string;
}

/** Global guard: authenticates the session cookie, then enforces @RequirePermission. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const token = req.cookies?.[ACCESS_COOKIE];
    if (!token) throw new UnauthorizedException('Not authenticated');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token);
    } catch {
      throw new UnauthorizedException('Session expired');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: { role: { include: { permissions: { include: { permission: true } } } } },
    });
    if (!user || !user.isActive || user.organizationId !== payload.org) throw new UnauthorizedException('Not authenticated');

    req.user = {
      id: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      roleName: user.role.name,
      permissions: user.role.permissions.map((rp) => rp.permission.key as PermissionKey),
    };

    const required = this.reflector.getAllAndOverride<PermissionKey | undefined>(REQUIRED_PERMISSION, targets);
    if (required && !req.user.permissions.includes(required)) {
      throw new ForbiddenException(`Missing permission: ${required}`);
    }
    return true;
  }
}
