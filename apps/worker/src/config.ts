import { z } from 'zod';

const schema = z.object({
  APP_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ENCRYPTION_KEY: z.string().min(1),
  MINIO_ENDPOINT: z.url(),
  MINIO_PUBLIC_ENDPOINT: z.url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_REGION: z.string().default('us-east-1'),
  /** e.g. smtp://user:pass@smtp.example.com:587 — required: download links are delivered by email. */
  SMTP_URL: z.string().min(1),
  MAIL_FROM: z.string().min(3),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(50).default(5),
});

export type WorkerConfig = z.infer<typeof schema>;

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid worker configuration:\n${parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n')}`);
  }
  return parsed.data;
}
