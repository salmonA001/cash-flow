'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { productCreateSchema } from '@cfe/validation';
import { Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import type { z } from 'zod';
import { DataTable } from '@/components/data-table';
import { Field, mutate, optional } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { useApi } from '@/hooks/use-api';
import { useList } from '@/hooks/use-list';
import { api } from '@/lib/api';
import { formatDate, formatMoney } from '@/lib/format';
import type { Design, Paginated, Product } from '@/types/api';

type ProductInput = z.input<typeof productCreateSchema>;

function CreateProductDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const { data: designs } = useApi<Paginated<Design>>(open ? '/designs?pageSize=100' : null);
  const form = useForm<ProductInput>({
    resolver: zodResolver(productCreateSchema),
    defaultValues: { variants: [{ sku: '', price: '', currency: 'USD' }] },
  });
  const variants = useFieldArray({ control: form.control, name: 'variants' });
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (values) => {
    let id = '';
    const ok = await mutate(async () => {
      id = (await api<{ id: string }>('/products', { method: 'POST', json: values })).id;
    }, 'Product created');
    if (ok) {
      setOpen(false);
      onCreated(id);
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> New product</Button></DialogTrigger>
      <DialogContent title="New POD product" description="Map Printful variants and print files on the product page." className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Title" error={errors.title?.message}><Input {...form.register('title')} /></Field>
            <Field label="Design">
              <Select {...form.register('designId', optional)}>
                <option value="">— None —</option>
                {designs?.items.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
              </Select>
            </Field>
            <Field label="Category"><Input {...form.register('category', optional)} placeholder="e.g. T-Shirts" /></Field>
            <Field label="Shopify product ID" hint="Optional, e.g. gid://shopify/Product/…"><Input {...form.register('shopifyProductId', optional)} /></Field>
          </div>
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Variants</p>
            {variants.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-2 gap-2 sm:grid-cols-[1.4fr_0.7fr_0.9fr_0.9fr_0.7fr_auto]">
                <Input aria-label="SKU" placeholder="SKU" {...form.register(`variants.${i}.sku`)} aria-invalid={!!errors.variants?.[i]?.sku} />
                <Input aria-label="Size" placeholder="Size" {...form.register(`variants.${i}.size`, optional)} />
                <Input aria-label="Color" placeholder="Color" {...form.register(`variants.${i}.color`, optional)} />
                <Input aria-label="Price" placeholder="24.99" inputMode="decimal" {...form.register(`variants.${i}.price`)} aria-invalid={!!errors.variants?.[i]?.price} />
                <Input aria-label="Currency" placeholder="USD" {...form.register(`variants.${i}.currency`)} />
                <Button type="button" variant="ghost" size="icon" aria-label="Remove variant" disabled={variants.fields.length === 1} onClick={() => variants.remove(i)}><Trash2 /></Button>
              </div>
            ))}
            {errors.variants && <p className="text-xs text-destructive">Check SKU, price (e.g. 24.99) and currency (e.g. USD) on every variant.</p>}
            <Button type="button" variant="outline" size="sm" onClick={() => variants.append({ sku: '', price: '', currency: 'USD' })}><Plus /> Add variant</Button>
          </div>
          <div className="flex justify-end"><Button type="submit" disabled={form.formState.isSubmitting}>Create product</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductsPage() {
  const router = useRouter();
  const list = useList<Product>('/products');
  return (
    <>
      <PageHeader title="Products" description="POD products, variants, SKUs and costs." actions={<CreateProductDialog onCreated={(id) => router.push(`/products/${id}`)} />} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <SearchInput value={list.q} onChange={list.setSearch} placeholder="Search title or SKU" />
          <Select aria-label="Type" className="w-36" value={list.filters.type ?? ''} onChange={(e) => list.setFilter('type', e.target.value)}>
            <option value="">All types</option><option value="POD">POD</option><option value="DIGITAL">Digital</option>
          </Select>
          <Select aria-label="Status" className="w-36" value={list.filters.status ?? ''} onChange={(e) => list.setFilter('status', e.target.value)}>
            <option value="">All statuses</option><option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option>
          </Select>
        </div>
        <DataTable
          rows={list.data?.items}
          isLoading={list.isLoading}
          error={list.error}
          rowKey={(p) => p.id}
          onRowClick={(p) => router.push(p.type === 'DIGITAL' ? '/digital' : `/products/${p.id}`)}
          pagination={list.pagination}
          empty={{ title: 'No products yet', description: 'Create a POD product from an approved design.' }}
          columns={[
            { header: 'Product', cell: (p) => <span className="font-medium">{p.title}</span> },
            { header: 'Type', cell: (p) => <StatusBadge status={p.type} /> },
            { header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
            { header: 'Design', cell: (p) => p.design?.title ?? '—' },
            { header: 'Variants', cell: (p) => p.variants.length, className: 'text-right tabular' },
            { header: 'Mapped to Printful', cell: (p) => (p.type === 'POD' ? `${p.variants.filter((v) => v.printfulVariantId && v.printFileAssetId).length}/${p.variants.length}` : 'n/a'), className: 'text-right tabular' },
            { header: 'Price', cell: (p) => (p.variants[0] ? formatMoney(p.variants[0].price, p.variants[0].currency) : '—'), className: 'text-right tabular' },
            { header: 'Updated', cell: (p) => formatDate(p.updatedAt) },
          ]}
        />
      </Card>
    </>
  );
}
