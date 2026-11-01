import { Controller, Get, Param } from '@nestjs/common';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { AssetsService } from './assets.service';

@Controller('assets')
export class AssetsController {
  constructor(private readonly assets: AssetsService) {}

  @Get(':id/url')
  @RequirePermission('designs:read')
  url(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.assets.presign(user.organizationId, id);
  }
}
