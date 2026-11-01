import { Module } from '@nestjs/common';
import { AuditController, InboxController } from './audit.controller';

@Module({ controllers: [AuditController, InboxController] })
export class AuditModule {}
