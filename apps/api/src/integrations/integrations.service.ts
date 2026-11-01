import { BadRequestException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'node:crypto';
import {
  buildInstallUrl,
  encryptSecret,
  exchangeOAuthCode,
  PrintfulAdapter,
  SHOPIFY_API_VERSION,
  SHOPIFY_SCOPES,
  ShopifyClient,
  verifyOAuthCallback,
} from '@cfe/integration-sdk';
import { IntegrationProvider } from '@cfe/database';
import { AuditService } from '../common/audit.service';
import { ENCRYPTION_KEY } from '../common/core.module';
import { AuthUser } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { APP_CONFIG, AppConfig } from '../config';

interface OAuthState {
  purpose: 'shopify-oauth';
  org: string;
  shop: string;
  nonce: string;
}

@Injectable()
export class IntegrationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly audit: AuditService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ENCRYPTION_KEY) private readonly key: Buffer,
  ) {}

  async statuses(orgId: string) {
    const creds = await this.prisma.integrationCredential.findMany({
      where: { organizationId: orgId },
      select: { provider: true, accountRef: true, status: true, scopes: true, connectedAt: true, lastCheckedAt: true, lastError: true },
    });
    const events = await this.prisma.integrationEvent.groupBy({ by: ['provider', 'status'], where: { organizationId: orgId }, _count: true });
    return (['SHOPIFY', 'PRINTFUL', 'AMAZON_MERCH'] as IntegrationProvider[]).map((provider) => ({
      provider,
      credential: creds.find((c) => c.provider === provider) ?? null,
      events: Object.fromEntries(events.filter((e) => e.provider === provider).map((e) => [e.status, e._count])),
      ...(provider === 'SHOPIFY' ? { apiVersion: SHOPIFY_API_VERSION, webhookUrl: `${this.config.APP_URL}/api/v1/webhooks/shopify` } : {}),
      ...(provider === 'PRINTFUL' ? { webhookUrl: `${this.config.APP_URL}/api/v1/webhooks/printful?token=<PRINTFUL_WEBHOOK_SECRET>` } : {}),
      ...(provider === 'AMAZON_MERCH' ? { note: 'Amazon Merch has no supported API for royalties; import CSV reports instead.' } : {}),
    }));
  }

  async status(orgId: string, provider: IntegrationProvider) {
    return (await this.statuses(orgId)).find((s) => s.provider === provider)!;
  }

  async shopifyInstallUrl(user: AuthUser, shop: string) {
    const state = await this.jwt.signAsync(
      { purpose: 'shopify-oauth', org: user.organizationId, shop, nonce: randomBytes(12).toString('hex') } satisfies OAuthState,
      { expiresIn: 600 },
    );
    await this.audit.log(user, 'integration.shopify.connect_started', 'IntegrationCredential', null, { shop });
    return {
      installUrl: buildInstallUrl({
        shop,
        clientId: this.config.SHOPIFY_CLIENT_ID,
        scopes: SHOPIFY_SCOPES,
        redirectUri: `${this.config.APP_URL}/api/v1/integrations/shopify/callback`,
        state,
      }),
    };
  }

  /** OAuth callback: verifies Shopify's HMAC and our signed state, stores the encrypted token, registers webhooks. */
  async shopifyCallback(query: Record<string, string>): Promise<void> {
    if (!verifyOAuthCallback(query, this.config.SHOPIFY_CLIENT_SECRET)) throw new UnauthorizedException('Invalid Shopify signature');
    let state: OAuthState;
    try {
      state = await this.jwt.verifyAsync<OAuthState>(query.state);
    } catch {
      throw new UnauthorizedException('OAuth state expired or invalid');
    }
    if (state.purpose !== 'shopify-oauth' || state.shop !== query.shop) throw new BadRequestException('OAuth state does not match shop');

    const { accessToken, scope } = await exchangeOAuthCode({
      shop: query.shop,
      clientId: this.config.SHOPIFY_CLIENT_ID,
      clientSecret: this.config.SHOPIFY_CLIENT_SECRET,
      code: query.code,
    });
    const client = new ShopifyClient({ shop: query.shop, accessToken });
    const registrations = await client.registerWebhooks(`${this.config.APP_URL}/api/v1/webhooks/shopify`);
    const failed = registrations.filter((r) => !r.ok);

    await this.prisma.integrationCredential.upsert({
      where: { organizationId_provider: { organizationId: state.org, provider: 'SHOPIFY' } },
      update: { accountRef: query.shop, encryptedSecret: encryptSecret(accessToken, this.key), scopes: scope, status: failed.length ? 'ERROR' : 'CONNECTED', lastError: failed.length ? JSON.stringify(failed) : null, connectedAt: new Date() },
      create: { organizationId: state.org, provider: 'SHOPIFY', accountRef: query.shop, encryptedSecret: encryptSecret(accessToken, this.key), scopes: scope, status: failed.length ? 'ERROR' : 'CONNECTED', lastError: failed.length ? JSON.stringify(failed) : null },
    });
    await this.prisma.auditLog.create({
      data: { organizationId: state.org, action: 'integration.shopify.connected', entityType: 'IntegrationCredential', metadata: { shop: query.shop, scope, webhookFailures: failed.length } },
    });
  }

  /** Validates the token with a read-only catalog call before storing it encrypted. */
  async connectPrintful(user: AuthUser, apiToken: string, storeId: string) {
    const adapter = new PrintfulAdapter({ apiToken, storeId });
    try {
      await adapter.getCatalog();
    } catch (err) {
      throw new BadRequestException(`Printful rejected the credentials: ${(err as Error).message}`);
    }
    const encryptedSecret = encryptSecret(apiToken, this.key);
    await this.prisma.integrationCredential.upsert({
      where: { organizationId_provider: { organizationId: user.organizationId, provider: 'PRINTFUL' } },
      update: { accountRef: storeId, encryptedSecret, status: 'CONNECTED', lastError: null, connectedAt: new Date(), lastCheckedAt: new Date() },
      create: { organizationId: user.organizationId, provider: 'PRINTFUL', accountRef: storeId, encryptedSecret, lastCheckedAt: new Date() },
    });
    await this.audit.log(user, 'integration.printful.connected', 'IntegrationCredential', null, { storeId });
    return this.status(user.organizationId, 'PRINTFUL');
  }

  async disconnect(user: AuthUser, provider: IntegrationProvider) {
    await this.prisma.integrationCredential.updateMany({
      where: { organizationId: user.organizationId, provider },
      data: { status: 'DISCONNECTED', encryptedSecret: '' },
    });
    await this.audit.log(user, 'integration.disconnected', 'IntegrationCredential', null, { provider });
    return this.status(user.organizationId, provider);
  }
}
