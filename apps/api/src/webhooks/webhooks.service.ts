import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { parsePrintfulWebhook, printfulEventId, verifyShopifyWebhook } from '@cfe/integration-sdk';
import { IntegrationProvider, Prisma } from '@cfe/database';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';
import { APP_CONFIG, AppConfig } from '../config';

export interface ShopifyWebhookHeaders {
  hmac?: string;
  shop?: string;
  topic?: string;
  webhookId?: string;
}

/**
 * Receives webhooks: verify signature → map to organization → store once (deduplicated by
 * provider event ID) → enqueue. Processing happens in the worker; payload values other than
 * resource IDs are never trusted — the worker re-fetches authoritative state from the provider.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private readonly prisma: PrismaService, private readonly queues: QueueService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async shopify(rawBody: Buffer | undefined, h: ShopifyWebhookHeaders): Promise<{ status: string }> {
    if (!rawBody || !verifyShopifyWebhook(rawBody, h.hmac, this.config.SHOPIFY_CLIENT_SECRET)) {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (!h.shop || !h.topic || !h.webhookId) throw new UnauthorizedException('Missing Shopify webhook headers');

    const body = JSON.parse(rawBody.toString('utf8')) as { admin_graphql_api_id?: string; order_id?: number };
    const reference =
      h.topic === 'refunds/create'
        ? { orderGid: `gid://shopify/Order/${body.order_id}` }
        : h.topic.startsWith('orders/')
          ? { orderGid: body.admin_graphql_api_id }
          : h.topic.startsWith('products/')
            ? { productGid: body.admin_graphql_api_id }
            : {};
    return this.store('SHOPIFY', h.shop, h.webhookId, h.topic, reference);
  }

  async printful(token: string | undefined, body: unknown): Promise<{ status: string }> {
    const expected = Buffer.from(this.config.PRINTFUL_WEBHOOK_SECRET);
    const given = Buffer.from(token ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException('Invalid webhook token');
    const payload = parsePrintfulWebhook(body);
    return this.store('PRINTFUL', String(payload.store), printfulEventId(payload), payload.type, {
      printfulOrderId: payload.data.order?.id ?? null,
      externalId: payload.data.order?.external_id ?? null,
    });
  }

  private async store(provider: IntegrationProvider, accountRef: string, eventId: string, topic: string, payload: Prisma.InputJsonValue) {
    const credential = await this.prisma.integrationCredential.findUnique({ where: { provider_accountRef: { provider, accountRef } } });
    if (!credential) {
      // Valid signature but no connected org (e.g. after uninstall). Acknowledge so the provider stops retrying.
      this.logger.warn(`Ignoring ${provider} webhook for unknown account ${accountRef}`);
      return { status: 'ignored' };
    }
    try {
      const event = await this.prisma.integrationEvent.create({
        data: { organizationId: credential.organizationId, provider, eventId, topic, payload },
      });
      await this.queues.enqueueIntegrationEvent(event.id);
      return { status: 'accepted' };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { status: 'duplicate' };
      throw err;
    }
  }
}
