import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { APP_CONFIG, AppConfig } from '../config';
import { SKIP_ORIGIN_CHECK } from './decorators';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defense for cookie-authenticated requests: state-changing requests must come from
 * the app's own origin (complements SameSite=Strict cookies).
 */
@Injectable()
export class OriginGuard implements CanActivate {
  private readonly allowedOrigin: string;

  constructor(private readonly reflector: Reflector, @Inject(APP_CONFIG) config: AppConfig) {
    this.allowedOrigin = new URL(config.APP_URL).origin;
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (this.reflector.getAllAndOverride<boolean>(SKIP_ORIGIN_CHECK, [ctx.getHandler(), ctx.getClass()])) return true;
    const origin = req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : undefined);
    if (origin !== this.allowedOrigin) throw new ForbiddenException('Cross-origin request rejected');
    return true;
  }
}
