import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

/** HTTP pipeline shared by main.ts and the API test-suite, so tests exercise the real setup. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'metrics'] });
  app.set('trust proxy', 'loopback, uniquelocal');
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.enableShutdownHooks();
  return app;
}
