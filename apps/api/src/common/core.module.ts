import { Global, Module } from '@nestjs/common';
import { loadEncryptionKey, StorageService } from '@cfe/integration-sdk';
import { APP_CONFIG, AppConfig, loadConfig } from '../config';
import { AuditService } from './audit.service';
import { PrismaService } from './prisma.service';
import { QueueService } from './queue.service';

export const ENCRYPTION_KEY = Symbol('ENCRYPTION_KEY');

@Global()
@Module({
  providers: [
    { provide: APP_CONFIG, useFactory: () => loadConfig() },
    {
      provide: StorageService,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) =>
        new StorageService({
          endpoint: c.MINIO_ENDPOINT,
          publicEndpoint: c.MINIO_PUBLIC_ENDPOINT,
          accessKey: c.MINIO_ACCESS_KEY,
          secretKey: c.MINIO_SECRET_KEY,
          region: c.MINIO_REGION,
        }),
    },
    { provide: ENCRYPTION_KEY, inject: [APP_CONFIG], useFactory: (c: AppConfig) => loadEncryptionKey(c.ENCRYPTION_KEY) },
    PrismaService,
    QueueService,
    AuditService,
  ],
  exports: [APP_CONFIG, StorageService, ENCRYPTION_KEY, PrismaService, QueueService, AuditService],
})
export class CoreModule {}
