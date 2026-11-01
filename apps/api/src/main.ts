import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { loadConfig } from './config';

async function main() {
  const config = loadConfig();
  const app = configureApp(await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true }));
  await app.listen(config.PORT, '0.0.0.0');
  Logger.log(`API listening on :${config.PORT}`, 'Bootstrap');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
