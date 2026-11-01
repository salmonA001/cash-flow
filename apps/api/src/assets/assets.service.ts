import { Injectable } from '@nestjs/common';
import { BucketName, BUCKETS, StorageService } from '@cfe/integration-sdk';
import { found } from '../common/owned';
import { PrismaService } from '../common/prisma.service';

/** Issues short-lived presigned URLs for private design assets. */
@Injectable()
export class AssetsService {
  constructor(private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  async presign(organizationId: string, assetId: string) {
    const asset = found(await this.prisma.designAsset.findFirst({ where: { id: assetId, organizationId } }), 'Asset');
    const url = await this.storage.presignedGet(asset.bucket as BucketName, asset.objectKey, 300);
    return { url, expiresInSeconds: 300 };
  }
}

export function bucketForAssetKind(kind: 'ORIGINAL' | 'PRINT_FILE' | 'MOCKUP' | 'PREVIEW'): BucketName {
  if (kind === 'ORIGINAL') return BUCKETS.designOriginals;
  if (kind === 'PRINT_FILE') return BUCKETS.designExports;
  return BUCKETS.designMockups;
}
