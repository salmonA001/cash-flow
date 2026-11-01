import { Body, Controller, Get, Post } from '@nestjs/common';
import { exchangeRateCreateSchema, payoutCreateSchema, z } from '@cfe/validation';
import { AuditService } from '../common/audit.service';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { PrismaService } from '../common/prisma.service';
import { ZodPipe } from '../common/zod.pipe';

/** Payouts record cash received for revenue already recognized; they never count as revenue. */
@Controller('finance/payouts')
export class PayoutsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('finance:read')
  list(@CurrentUser() user: AuthUser) {
    return this.prisma.payout.findMany({ where: { organizationId: user.organizationId }, orderBy: { periodEnd: 'desc' }, take: 200 });
  }

  @Post()
  @RequirePermission('finance:write')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(payoutCreateSchema)) body: z.infer<typeof payoutCreateSchema>) {
    const payout = await this.prisma.payout.create({
      data: {
        ...body,
        organizationId: user.organizationId,
        periodStart: new Date(body.periodStart),
        periodEnd: new Date(body.periodEnd),
        paidAt: body.paidAt ? new Date(body.paidAt) : null,
        status: body.paidAt ? 'PAID' : 'EXPECTED',
      },
    });
    await this.audit.log(user, 'payout.recorded', 'Payout', payout.id, body);
    return payout;
  }
}

@Controller('finance/exchange-rates')
export class ExchangeRatesController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  @Get()
  @RequirePermission('finance:read')
  list() {
    return this.prisma.exchangeRate.findMany({ orderBy: [{ rateDate: 'desc' }, { base: 'asc' }], take: 500 });
  }

  @Post()
  @RequirePermission('finance:write')
  async create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(exchangeRateCreateSchema)) body: z.infer<typeof exchangeRateCreateSchema>) {
    const rate = await this.prisma.exchangeRate.create({ data: { ...body, rateDate: new Date(body.rateDate), source: `manual:${user.email}` } });
    await this.audit.log(user, 'exchange_rate.created', 'ExchangeRate', rate.id, body);
    return rate;
  }
}
