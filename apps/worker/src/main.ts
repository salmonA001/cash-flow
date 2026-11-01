import { createPrismaClient } from '@cfe/database';
import { loadEncryptionKey, StorageService } from '@cfe/integration-sdk';
import { QUEUES } from '@cfe/shared-types';
import type { AmazonImportJob, EntitlementGrantJob, FulfillmentSubmitJob, IntegrationEventJob, MaintenanceJobName, OrderWorkflowJob } from '@cfe/shared-types';
import { Job, Worker } from 'bullmq';
import IORedis from 'ioredis';
import { loadWorkerConfig } from './config';
import { providerFactories, WorkerContext } from './context';
import { createSmtpMailer } from './mailer';
import { importAmazonReport } from './processors/amazon-import';
import { grantEntitlement } from './processors/entitlement';
import { submitFulfillment } from './processors/fulfillment-submit';
import { processIntegrationEvent } from './processors/integration-event';
import { checkIntegrations, cleanupTemporaryUploads, reconcilePayouts, reconcilePrintful, reconcileShopify } from './processors/maintenance';
import { runOrderWorkflow } from './processors/order-workflow';

async function main() {
  const config = loadWorkerConfig();
  const prisma = createPrismaClient(config.DATABASE_URL);
  const storage = new StorageService({
    endpoint: config.MINIO_ENDPOINT,
    publicEndpoint: config.MINIO_PUBLIC_ENDPOINT,
    accessKey: config.MINIO_ACCESS_KEY,
    secretKey: config.MINIO_SECRET_KEY,
    region: config.MINIO_REGION,
  });
  await storage.ensureBuckets();
  const ctx: WorkerContext = {
    prisma,
    storage,
    mailer: createSmtpMailer(config.SMTP_URL, config.MAIL_FROM),
    appUrl: config.APP_URL,
    ...providerFactories(prisma, loadEncryptionKey(config.ENCRYPTION_KEY)),
  };
  const connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
  const opts = { connection, concurrency: config.WORKER_CONCURRENCY };

  const maintenance: Record<MaintenanceJobName, () => Promise<unknown>> = {
    'integrations.health': () => checkIntegrations(ctx),
    'payouts.reconcile': () => reconcilePayouts(ctx),
    'shopify.reconcile': () => reconcileShopify(ctx),
    'printful.reconcile': () => reconcilePrintful(ctx),
    'storage.cleanup-temp': () => cleanupTemporaryUploads(ctx),
  };

  const workers = [
    new Worker<IntegrationEventJob>(QUEUES.integrationEvents, (job) => processIntegrationEvent(ctx, job.data.integrationEventId), opts),
    new Worker<OrderWorkflowJob>(QUEUES.orders, (job) => runOrderWorkflow(ctx, job.data.orderId), opts),
    // Live fulfillment: one job at a time, single attempt (set by the producer).
    new Worker<FulfillmentSubmitJob>(QUEUES.fulfillment, (job) => submitFulfillment(ctx, job.data.fulfillmentOrderId, job.data.automationRunId), { connection, concurrency: 1 }),
    new Worker<EntitlementGrantJob>(QUEUES.digital, async (job) => {
      try {
        const output = await grantEntitlement(ctx, job.data.orderItemId);
        await prisma.automationRun.update({ where: { id: job.data.automationRunId }, data: { status: 'SUCCEEDED', output, finishedAt: new Date(), attempts: job.attemptsMade + 1 } });
      } catch (err) {
        await prisma.automationRun.update({ where: { id: job.data.automationRunId }, data: { status: 'FAILED', error: (err as Error).message, finishedAt: new Date(), attempts: job.attemptsMade + 1 } });
        throw err;
      }
    }, opts),
    new Worker<AmazonImportJob>(QUEUES.amazonImports, (job) => importAmazonReport(ctx, job.data.importId), opts),
    new Worker(QUEUES.maintenance, (job: Job) => {
      const handler = maintenance[job.name as MaintenanceJobName];
      if (!handler) throw new Error(`Unknown maintenance job ${job.name}`);
      return handler();
    }, { connection, concurrency: 1 }),
  ];

  for (const w of workers) {
    w.on('failed', (job, err) => console.error(`[${w.name}] job ${job?.id} failed (attempt ${job?.attemptsMade}): ${err.message}`));
  }
  console.log(`Worker started: ${workers.map((w) => w.name).join(', ')}`);

  const shutdown = async () => {
    await Promise.all(workers.map((w) => w.close()));
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
