import { QUEUES } from '@cfe/shared-types';
import type { MaintenanceJobName } from '@cfe/shared-types';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

/** Registers repeatable maintenance jobs (idempotent upserts), then exits. */
const SCHEDULES: Record<MaintenanceJobName, string> = {
  'shopify.reconcile': '17 * * * *', // hourly
  'printful.reconcile': '*/30 * * * *',
  'integrations.health': '7 */6 * * *',
  'payouts.reconcile': '23 4 * * *', // daily
  'storage.cleanup-temp': '41 3 * * *',
};

async function main() {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) throw new Error('REDIS_URL is not set');
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(QUEUES.maintenance, { connection });
  for (const [name, pattern] of Object.entries(SCHEDULES)) {
    await queue.upsertJobScheduler(name, { pattern, tz: 'UTC' }, { name, opts: { attempts: 3, backoff: { type: 'exponential', delay: 60_000 }, removeOnComplete: 100, removeOnFail: 500 } });
    console.log(`Scheduled ${name}: ${pattern} UTC`);
  }
  await queue.close();
  await connection.quit();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
