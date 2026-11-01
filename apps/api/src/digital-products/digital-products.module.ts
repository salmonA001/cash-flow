import { Module } from '@nestjs/common';
import { DigitalProductsController } from './digital-products.controller';

@Module({ controllers: [DigitalProductsController] })
export class DigitalProductsModule {}
