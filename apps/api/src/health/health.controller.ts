import { Controller, Get, Header, Res } from '@nestjs/common';
import { StorageService } from '@cfe/integration-sdk';
import type { Response } from 'express';
import { collectDefaultMetrics, register } from 'prom-client';
import { Public } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { QueueService } from '../common/queue.service';

collectDefaultMetrics({ prefix: 'cfe_api_' });

async function check(fn: () => Promise<unknown>): Promise<'ok' | string> {
  try {
    await fn();
    return 'ok';
  } catch (err) {
    return err instanceof Error ? err.message : 'error';
  }
}

@Controller()
export class HealthController {
  constructor(private readonly prisma: PrismaService, private readonly queues: QueueService, private readonly storage: StorageService) {}

  @Public()
  @Get('health')
  async health(@Res({ passthrough: true }) res: Response) {
    const checks = {
      database: await check(() => this.prisma.$queryRaw`SELECT 1`),
      redis: await check(() => this.queues.ping()),
      storage: await check(() => this.storage.ping()),
    };
    const healthy = Object.values(checks).every((v) => v === 'ok');
    res.status(healthy ? 200 : 503);
    return { status: healthy ? 'ok' : 'degraded', checks };
  }

  /** Prometheus scrape endpoint. Not routed publicly by Caddy. */
  @Public()
  @Get('metrics')
  @Header('Content-Type', register.contentType)
  metrics() {
    return register.metrics();
  }
}
