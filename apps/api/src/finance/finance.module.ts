import { Module } from '@nestjs/common';
import { ExpensesController } from '../expenses/expenses.controller';
import { ExchangeRatesController, PayoutsController } from '../payouts/payouts.controller';
import { FinanceController } from './finance.controller';
import { LedgerService } from './ledger.service';

@Module({ controllers: [FinanceController, ExpensesController, PayoutsController, ExchangeRatesController], providers: [LedgerService], exports: [LedgerService] })
export class FinanceModule {}
