import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { PermissionKey } from '@cfe/business-rules';

export interface AuthUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  roleName: string;
  permissions: PermissionKey[];
}

export const IS_PUBLIC = 'isPublic';
/** No session required (webhooks, login, public download links). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const SKIP_ORIGIN_CHECK = 'skipOriginCheck';
/** Server-to-server endpoints authenticated by signature instead of cookies. */
export const SkipOriginCheck = () => SetMetadata(SKIP_ORIGIN_CHECK, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
export const RequirePermission = (permission: PermissionKey) => SetMetadata(REQUIRED_PERMISSION, permission);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest().user;
  if (!user) throw new Error('CurrentUser used on a public route');
  return user;
});
