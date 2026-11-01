import { Module } from '@nestjs/common';
import { AmazonMerchController } from './amazon-merch.controller';

@Module({ controllers: [AmazonMerchController] })
export class AmazonMerchModule {}
