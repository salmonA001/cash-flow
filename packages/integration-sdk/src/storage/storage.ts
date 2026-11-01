import { createHash } from 'node:crypto';
import { Client } from 'minio';

export const BUCKETS = {
  designOriginals: 'design-originals',
  designExports: 'design-exports',
  designMockups: 'design-mockups',
  digitalProducts: 'digital-products',
  temporaryUploads: 'temporary-uploads',
  // Original Amazon Merch reports, archived permanently for audit and re-processing.
  reportArchives: 'report-archives',
} as const;

export type BucketName = (typeof BUCKETS)[keyof typeof BUCKETS];

export interface StorageConfig {
  /** Internal endpoint used by the API/worker, e.g. http://minio:9000 */
  endpoint: string;
  /** Browser-reachable endpoint used to sign presigned URLs, e.g. https://files.example.com */
  publicEndpoint: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

export interface StoredObject {
  bucket: BucketName;
  objectKey: string;
  sizeBytes: number;
  checksumSha256: string;
}

function toClient(url: string, cfg: StorageConfig): Client {
  const u = new URL(url);
  return new Client({
    endPoint: u.hostname,
    port: u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80,
    useSSL: u.protocol === 'https:',
    accessKey: cfg.accessKey,
    secretKey: cfg.secretKey,
    // A fixed region keeps presigning fully offline (no bucket-region lookup).
    region: cfg.region,
  });
}

/** Private object storage. All buckets are private; access is only via short-lived presigned URLs. */
export class StorageService {
  private readonly internal: Client;
  private readonly signer: Client;

  constructor(cfg: StorageConfig) {
    this.internal = toClient(cfg.endpoint, cfg);
    this.signer = toClient(cfg.publicEndpoint, cfg);
  }

  async ensureBuckets(): Promise<void> {
    for (const bucket of Object.values(BUCKETS)) {
      if (!(await this.internal.bucketExists(bucket))) await this.internal.makeBucket(bucket);
    }
  }

  async putObject(bucket: BucketName, objectKey: string, data: Buffer, contentType: string): Promise<StoredObject> {
    const checksumSha256 = createHash('sha256').update(data).digest('hex');
    await this.internal.putObject(bucket, objectKey, data, data.length, {
      'Content-Type': contentType,
      'X-Amz-Meta-Sha256': checksumSha256,
    });
    const stat = await this.internal.statObject(bucket, objectKey);
    if (stat.size !== data.length) {
      throw new Error(`Upload verification failed for ${bucket}/${objectKey}: size ${stat.size} != ${data.length}`);
    }
    return { bucket, objectKey, sizeBytes: data.length, checksumSha256 };
  }

  async getObject(bucket: BucketName, objectKey: string): Promise<Buffer> {
    const stream = await this.internal.getObject(bucket, objectKey);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    return Buffer.concat(chunks);
  }

  /** Short-lived signed GET URL. `downloadName` forces an attachment filename. */
  async presignedGet(bucket: BucketName, objectKey: string, expirySeconds: number, downloadName?: string): Promise<string> {
    if (expirySeconds < 1 || expirySeconds > 3600) throw new Error('Presigned URL expiry must be 1–3600 seconds');
    const headers = downloadName
      ? { 'response-content-disposition': `attachment; filename="${downloadName.replace(/["\\\r\n]/g, '_')}"` }
      : undefined;
    return this.signer.presignedGetObject(bucket, objectKey, expirySeconds, headers);
  }

  async removeObject(bucket: BucketName, objectKey: string): Promise<void> {
    await this.internal.removeObject(bucket, objectKey);
  }

  /** Deletes temporary uploads older than `maxAgeMs`. Returns the number removed. */
  async cleanupTemporaryUploads(maxAgeMs: number, now = new Date()): Promise<number> {
    const stale: string[] = [];
    const stream = this.internal.listObjectsV2(BUCKETS.temporaryUploads, '', true);
    for await (const obj of stream as AsyncIterable<{ name?: string; lastModified?: Date }>) {
      if (obj.name && obj.lastModified && now.getTime() - obj.lastModified.getTime() > maxAgeMs) stale.push(obj.name);
    }
    if (stale.length) await this.internal.removeObjects(BUCKETS.temporaryUploads, stale);
    return stale.length;
  }

  async ping(): Promise<void> {
    await this.internal.bucketExists(BUCKETS.temporaryUploads);
  }
}

/** Structured object keys: {orgId}/{entity}/{entityId}/{timestamp}-{safeName} */
export function buildObjectKey(orgId: string, entity: string, entityId: string, fileName: string, now = new Date()): string {
  const safe = fileName.normalize('NFKD').replace(/[^\w.-]+/g, '_').slice(-120);
  return `${orgId}/${entity}/${entityId}/${now.getTime()}-${safe}`;
}
