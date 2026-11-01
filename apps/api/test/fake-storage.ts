import { createHash } from 'node:crypto';
import type { BucketName, StoredObject } from '@cfe/integration-sdk';

/** In-memory stand-in for StorageService (same public surface). */
export class FakeStorage {
  readonly objects = new Map<string, { data: Buffer; contentType: string }>();

  async ensureBuckets() {}
  async ping() {}

  async putObject(bucket: BucketName, objectKey: string, data: Buffer, contentType: string): Promise<StoredObject> {
    this.objects.set(`${bucket}/${objectKey}`, { data, contentType });
    return { bucket, objectKey, sizeBytes: data.length, checksumSha256: createHash('sha256').update(data).digest('hex') };
  }

  async getObject(bucket: BucketName, objectKey: string): Promise<Buffer> {
    const o = this.objects.get(`${bucket}/${objectKey}`);
    if (!o) throw new Error(`NoSuchKey ${bucket}/${objectKey}`);
    return o.data;
  }

  async presignedGet(bucket: BucketName, objectKey: string, expirySeconds: number) {
    return `http://storage.test/${bucket}/${objectKey}?X-Amz-Expires=${expirySeconds}`;
  }

  async removeObject(bucket: BucketName, objectKey: string) {
    this.objects.delete(`${bucket}/${objectKey}`);
  }

  async cleanupTemporaryUploads() {
    return 0;
  }
}
