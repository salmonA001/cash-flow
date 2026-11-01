import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { APP_CONFIG, AppConfig } from './config';

/** HTTP pipeline shared by main.ts and the API test-suite, so tests exercise the real setup. */
export function configureApp(app: NestExpressApplication): NestExpressApplication {
  const config = app.get<AppConfig>(APP_CONFIG);
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'metrics'] });
  app.set('trust proxy', 'loopback, uniquelocal');
  // The web app (e.g. app.example.com on Vercel) calls this API (api.example.com) directly.
  // Only that exact origin may make credentialed requests; both hosts must share a site so
  // SameSite=Strict session cookies are sent.
  app.enableCors({ origin: [new URL(config.APP_URL).origin], credentials: true, maxAge: 600 });
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '2mb' });
  app.enableShutdownHooks();
  return app;
}
