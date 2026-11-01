import { PrismaClient } from '@cfe/database';
import { decryptSecret, FulfillmentProvider, PrintfulAdapter, ShopifyClient, StorageService } from '@cfe/integration-sdk';

export interface Mailer {
  send(message: { to: string; subject: string; text: string }): Promise<void>;
}

/** Storage operations the worker needs (StorageService in production, a double in tests). */
export type WorkerStorage = Pick<StorageService, 'getObject' | 'presignedGet' | 'cleanupTemporaryUploads'>;

export interface WorkerContext {
  prisma: PrismaClient;
  storage: WorkerStorage;
  mailer: Mailer;
  apiUrl: string;
  shopify(organizationId: string): Promise<Pick<ShopifyClient, 'getOrder' | 'listOrderIdsUpdatedSince'>>;
  printful(organizationId: string): Promise<FulfillmentProvider>;
}

export class IntegrationNotConnectedError extends Error {}

async function credential(prisma: PrismaClient, organizationId: string, provider: 'SHOPIFY' | 'PRINTFUL', key: Buffer) {
  const cred = await prisma.integrationCredential.findUnique({ where: { organizationId_provider: { organizationId, provider } } });
  if (!cred || cred.status === 'DISCONNECTED') throw new IntegrationNotConnectedError(`${provider} is not connected`);
  return { accountRef: cred.accountRef, secret: decryptSecret(cred.encryptedSecret, key) };
}

/** Production provider factories: decrypt the org's stored credential and build a client. */
export function providerFactories(prisma: PrismaClient, key: Buffer) {
  return {
    shopify: async (orgId: string) => {
      const c = await credential(prisma, orgId, 'SHOPIFY', key);
      return new ShopifyClient({ shop: c.accountRef, accessToken: c.secret });
    },
    printful: async (orgId: string) => {
      const c = await credential(prisma, orgId, 'PRINTFUL', key);
      return new PrintfulAdapter({ apiToken: c.secret, storeId: c.accountRef });
    },
  };
}
