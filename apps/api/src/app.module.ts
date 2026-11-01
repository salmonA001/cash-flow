import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AmazonMerchModule } from './amazon-merch/amazon-merch.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AssetsModule } from './assets/assets.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AutomationModule } from './automation/automation.module';
import { CollectionsModule } from './collections/collections.module';
import { AuthGuard } from './common/auth.guard';
import { CoreModule } from './common/core.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { OriginGuard } from './common/origin.guard';
import { APP_CONFIG, AppConfig } from './config';
import { CustomersModule } from './customers/customers.module';
import { DesignsModule } from './designs/designs.module';
import { DigitalProductsModule } from './digital-products/digital-products.module';
import { DownloadsModule } from './downloads/downloads.module';
import { FinanceModule } from './finance/finance.module';
import { FulfillmentModule } from './fulfillment/fulfillment.module';
import { HealthModule } from './health/health.module';
import { IntegrationsModule } from './integrations/integrations.module';
import { ListingsModule } from './listings/listings.module';
import { OrdersModule } from './orders/orders.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { ProductsModule } from './products/products.module';
import { UsersModule } from './users/users.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    CoreModule,
    JwtModule.registerAsync({
      global: true,
      inject: [APP_CONFIG],
      useFactory: (c: AppConfig) => ({ secret: c.JWT_SECRET, signOptions: { algorithm: 'HS256' }, verifyOptions: { algorithms: ['HS256'] } }),
    }),
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 300 }]),
    HealthModule,
    AuthModule,
    UsersModule,
    OrganizationsModule,
    AuditModule,
    DesignsModule,
    CollectionsModule,
    AssetsModule,
    ProductsModule,
    ListingsModule,
    OrdersModule,
    CustomersModule,
    FulfillmentModule,
    DigitalProductsModule,
    DownloadsModule,
    AmazonMerchModule,
    FinanceModule,
    AnalyticsModule,
    AutomationModule,
    IntegrationsModule,
    WebhooksModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: OriginGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule {}
