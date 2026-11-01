import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  /** Public origin of the web app (Vercel). The only origin allowed by CORS and the CSRF origin check. */
  APP_URL: z.url(),
  /** Public URL of this API (e.g. https://api.example.com). Used for webhook and OAuth callback URLs. */
  API_PUBLIC_URL: z.url(),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  ENCRYPTION_KEY: z.string().min(1),
  COOKIE_SECURE: z.enum(['true', 'false']).transform((v) => v === 'true'),
  MINIO_ENDPOINT: z.url(),
  MINIO_PUBLIC_ENDPOINT: z.url(),
  MINIO_ACCESS_KEY: z.string().min(1),
  MINIO_SECRET_KEY: z.string().min(8),
  MINIO_REGION: z.string().default('us-east-1'),
  SHOPIFY_CLIENT_ID: z.string().min(1),
  SHOPIFY_CLIENT_SECRET: z.string().min(1),
  PRINTFUL_WEBHOOK_SECRET: z.string().min(24, 'PRINTFUL_WEBHOOK_SECRET must be at least 24 characters'),
});

export type AppConfig = z.infer<typeof schema>;

/** Fails fast at boot with every invalid variable listed. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
