import { Body, Controller, Get, Inject, Param, ParseEnumPipe, Post, Query, Res } from '@nestjs/common';
import { IntegrationProvider } from '@cfe/database';
import { printfulConnectSchema, shopifyConnectSchema, z } from '@cfe/validation';
import type { Response } from 'express';
import { AuthUser, CurrentUser, Public, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, AppConfig } from '../config';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
export class IntegrationsController {
  constructor(private readonly integrations: IntegrationsService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get()
  @RequirePermission('settings:write')
  all(@CurrentUser() user: AuthUser) {
    return this.integrations.statuses(user.organizationId);
  }

  @Post('shopify/connect')
  @RequirePermission('integrations:write')
  connectShopify(@CurrentUser() user: AuthUser, @Body(new ZodPipe(shopifyConnectSchema)) body: z.infer<typeof shopifyConnectSchema>) {
    return this.integrations.shopifyInstallUrl(user, body.shop);
  }

  /** Browser redirect target from Shopify. Authenticated by Shopify HMAC + our signed state (no cookie). */
  @Public()
  @Get('shopify/callback')
  async shopifyCallback(@Query() query: Record<string, string>, @Res() res: Response) {
    await this.integrations.shopifyCallback(query);
    res.redirect(302, `${this.config.APP_URL}/settings?integration=shopify-connected`);
  }

  @Get('shopify/status')
  @RequirePermission('settings:write')
  shopifyStatus(@CurrentUser() user: AuthUser) {
    return this.integrations.status(user.organizationId, 'SHOPIFY');
  }

  @Post('printful/connect')
  @RequirePermission('integrations:write')
  connectPrintful(@CurrentUser() user: AuthUser, @Body(new ZodPipe(printfulConnectSchema)) body: z.infer<typeof printfulConnectSchema>) {
    return this.integrations.connectPrintful(user, body.apiToken, body.storeId);
  }

  @Get('printful/status')
  @RequirePermission('settings:write')
  printfulStatus(@CurrentUser() user: AuthUser) {
    return this.integrations.status(user.organizationId, 'PRINTFUL');
  }

  @Post(':provider/disconnect')
  @RequirePermission('integrations:write')
  disconnect(@CurrentUser() user: AuthUser, @Param('provider', new ParseEnumPipe(IntegrationProvider)) provider: IntegrationProvider) {
    return this.integrations.disconnect(user, provider);
  }
}
