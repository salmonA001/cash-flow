import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { grantDownloadSchema, revokeDownloadSchema, z } from '@cfe/validation';
import type { Request, Response } from 'express';
import { AuthUser, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DownloadsService } from './downloads.service';

@Controller('downloads')
export class DownloadsController {
  constructor(private readonly downloads: DownloadsService) {}

  /** :id = digital product ID */
  @Post(':id/grant')
  @HttpCode(202)
  @RequirePermission('digital:write')
  grant(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(grantDownloadSchema)) body: z.infer<typeof grantDownloadSchema>) {
    return this.downloads.grant(user, id, body.orderItemId);
  }

  /** :id = entitlement ID */
  @Post(':id/revoke')
  @RequirePermission('digital:write')
  revoke(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(revokeDownloadSchema)) body: z.infer<typeof revokeDownloadSchema>) {
    return this.downloads.revoke(user, id, body.reason);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('access/:token')
  async access(@Param('token') token: string, @Req() req: Request, @Res() res: Response) {
    const url = await this.downloads.access(token, { ip: req.ip, userAgent: req.headers['user-agent'] });
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.redirect(302, url);
  }
}
