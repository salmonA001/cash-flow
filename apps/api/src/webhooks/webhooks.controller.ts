import { Body, Controller, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { Public, SkipOriginCheck } from '../common/decorators';
import { WebhooksService } from './webhooks.service';

@Public()
@SkipOriginCheck()
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}

  @Post('shopify')
  @HttpCode(200)
  shopify(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-shopify-hmac-sha256') hmac?: string,
    @Headers('x-shopify-shop-domain') shop?: string,
    @Headers('x-shopify-topic') topic?: string,
    @Headers('x-shopify-webhook-id') webhookId?: string,
  ) {
    return this.webhooks.shopify(req.rawBody, { hmac, shop, topic, webhookId });
  }

  @Post('printful')
  @HttpCode(200)
  printful(@Query('token') token: string | undefined, @Body() body: unknown) {
    return this.webhooks.printful(token, body);
  }
}
