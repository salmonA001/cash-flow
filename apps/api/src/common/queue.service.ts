import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { QUEUES, AmazonImportJob, EntitlementGrantJob, FulfillmentSubmitJob, IntegrationEventJob, OrderWorkflowJob } from '@cfe/shared-types';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { APP_CONFIG, AppConfig } from '../config';

/** Producer side of the job queues. Workers live in apps/worker. */
@Injectable()
export class QueueService implements OnModuleDestroy {
  readonly connection: IORedis;
  private readonly integration: Queue<IntegrationEventJob>;
  private readonly orders: Queue<OrderWorkflowJob>;
  private readonly fulfillment: Queue<FulfillmentSubmitJob>;
  private readonly amazon: Queue<AmazonImportJob>;
  private readonly digital: Queue<EntitlementGrantJob>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.connection = new IORedis(config.REDIS_URL, { maxRetriesPerRequest: null });
    this.integration = new Queue(QUEUES.integrationEvents, { connection: this.connection });
    this.orders = new Queue(QUEUES.orders, { connection: this.connection });
    this.fulfillment = new Queue(QUEUES.fulfillment, { connection: this.connection });
    this.amazon = new Queue(QUEUES.amazonImports, { connection: this.connection });
    this.digital = new Queue(QUEUES.digital, { connection: this.connection });
  }

  /** Safe to retry: event processing is idempotent (upserts keyed by provider IDs). */
  enqueueIntegrationEvent(integrationEventId: string) {
    return this.integration.add('process', { integrationEventId }, {
      jobId: `ie-${integrationEventId}`,
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  /** Idempotent: the workflow checks existing fulfillments/entitlements before creating anything. */
  enqueueOrderWorkflow(orderId: string) {
    return this.orders.add('workflow', { orderId }, {
      attempts: 5,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  /** Live fulfillment is NEVER retried automatically: a single attempt per explicit human action. */
  enqueueFulfillmentSubmit(job: FulfillmentSubmitJob) {
    return this.fulfillment.add('submit', job, { jobId: `fs-${job.automationRunId}`, attempts: 1, removeOnComplete: 1000, removeOnFail: 5000 });
  }

  enqueueAmazonImport(importId: string) {
    return this.amazon.add('import', { importId }, {
      jobId: `ai-${importId}-${Date.now()}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 10_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  enqueueEntitlementGrant(orderItemId: string, automationRunId: string) {
    return this.digital.add('grant', { orderItemId, automationRunId }, {
      jobId: `eg-${automationRunId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5_000 },
      removeOnComplete: 1000,
      removeOnFail: 5000,
    });
  }

  async ping(): Promise<void> {
    await this.connection.ping();
  }

  async onModuleDestroy() {
    await Promise.all([this.integration.close(), this.orders.close(), this.fulfillment.close(), this.amazon.close(), this.digital.close()]);
    await this.connection.quit();
  }
}
