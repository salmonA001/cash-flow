import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { productCreateSchema, productListQuery, productUpdateSchema, variantSchema, variantUpdateSchema, z } from '@cfe/validation';
import { AuthUser, CurrentUser, RequirePermission } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Get()
  @RequirePermission('products:read')
  list(@CurrentUser() user: AuthUser, @Query(new ZodPipe(productListQuery)) q: z.infer<typeof productListQuery>) {
    return this.products.list(user.organizationId, q);
  }

  @Post()
  @RequirePermission('products:write')
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(productCreateSchema)) body: z.infer<typeof productCreateSchema>) {
    return this.products.create(user, body);
  }

  @Get(':id')
  @RequirePermission('products:read')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.products.get(user.organizationId, id);
  }

  @Patch(':id')
  @RequirePermission('products:write')
  update(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(productUpdateSchema)) body: z.infer<typeof productUpdateSchema>) {
    return this.products.update(user, id, body);
  }

  @Post(':id/variants')
  @RequirePermission('products:write')
  addVariant(@CurrentUser() user: AuthUser, @Param('id') id: string, @Body(new ZodPipe(variantSchema)) body: z.infer<typeof variantSchema>) {
    return this.products.addVariant(user, id, body);
  }

  @Patch(':id/variants/:variantId')
  @RequirePermission('products:write')
  updateVariant(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('variantId') variantId: string,
    @Body(new ZodPipe(variantUpdateSchema)) body: z.infer<typeof variantUpdateSchema>,
  ) {
    return this.products.updateVariant(user, id, variantId, body);
  }
}
