import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { APP_CONFIG, AppConfig } from './config';

/** HTTP pipeline shared by main.ts and the API test-suite, so tests exercise the real setup. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'metrics'] });
  app.set('trust proxy', 'loopback, uniquelocal');
  // In production Caddy serves the web app and this API (under /api) on one origin. Only that
  // origin may make credentialed requests (CORS matters for local development, where the web
  // app on :3000 calls the API on :4000).
  app.enableCors({ origin: [new URL(config.APP_URL).origin], credentials: true, maxAge: 600 });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.enableShutdownHooks();
  return app;
}
