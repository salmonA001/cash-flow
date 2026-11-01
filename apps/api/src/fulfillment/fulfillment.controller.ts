import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { fulfillmentListQuery, fulfillmentSubmitSchema, z } from '@cfe/validation';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { FulfillmentService } from './fulfillment.service';

@Controller('fulfillment')
export class FulfillmentController {
  constructor(private readonly fulfillment: FulfillmentService) {}

  @Get()
  @RequirePermission('fulfillment:read')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(fulfillmentListQuery)) q: z.infer<typeof fulfillmentListQuery>) {
    return this.fulfillment.list(user.organizationId, q);
  }

  /** Body must be { "confirm": true } — an explicit acknowledgement that this is a live, billable action. */
  @Post(':id/submit')
  @HttpCode(202)
  @RequirePermission('fulfillment:approve')
  submit(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(fulfillmentSubmitSchema)) _body: { confirm: true }) {
    return this.fulfillment.submit(user, id);
  }

  @Post(':id/retry')
  @HttpCode(202)
  @RequirePermission('fulfillment:approve')
  retry(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(fulfillmentSubmitSchema)) _body: { confirm: true }) {
    return this.fulfillment.retry(user, id);
  }
}
