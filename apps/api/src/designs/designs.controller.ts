import { Body, Controller, Get, Param, Patch, Post, Query, UploadedFile as UploadedFileParam, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DESIGN_FILE_POLICY } from '@cfe/integration-sdk';
import { assetUploadSchema, designCreateSchema, designListQuery, designUpdateSchema, z } from '@cfe/validation';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { DesignsService, UploadedFile } from './designs.service';

@Controller('designs')
export class DesignsController {
  constructor(private readonly designs: DesignsService) {}

  @Get()
  @RequirePermission('designs:read')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(designListQuery)) q: z.infer<typeof designListQuery>) {
    return this.designs.list(user.organizationId, q);
  }

  @Post()
  @RequirePermission('designs:write')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(designCreateSchema)) body: z.infer<typeof designCreateSchema>) {
    return this.designs.create(user, body);
  }

  @Get(':id')
  @RequirePermission('designs:read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.designs.get(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission('designs:write')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(designUpdateSchema)) body: z.infer<typeof designUpdateSchema>) {
    return this.designs.update(user, id, body);
  }

  @Post(':id/assets')
  @RequirePermission('designs:write')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: DESIGN_FILE_POLICY.maxBytes, files: 1 } }))
  upload(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @UploadedFileParam() file: UploadedFile | undefined,
    @Body(new ZodPipe(assetUploadSchema)) body: z.infer<typeof assetUploadSchema>,
  ) {
    return this.designs.uploadAsset(user, id, file, body);
  }
}
