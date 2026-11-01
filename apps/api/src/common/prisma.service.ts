import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@cfe/database';
import { APP_CONFIG, AppConfig } from '../config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({ datasources: { db: { url: config.DATABASE_URL } } });
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
