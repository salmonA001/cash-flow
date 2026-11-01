'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { digitalProductCreateSchema } from '@cfe/validation';
import { Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { DataTable } from '@/components/data-table';
import { Field, mutate, optional } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { useList } from '@/hooks/use-list';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { Variant } from '@/types/api';

export interface DigitalProductRow {
  id: string;
  maxDownloads: number;
  accessDays: number;
  product: { id: string; title: string; description: string | null; status: string; variants: Variant[] };
  assets: { id: string; version: number; fileName: string; sizeBytes: number }[];
  _count: { entitlements: number };
}

type FormValues = z.input<typeof digitalProductCreateSchema>;

function CreateDigitalDialog({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<FormValues>({ resolver: zodResolver(digitalProductCreateSchema), defaultValues: { currency: 'USD', maxDownloads: 5, accessDays: 30 } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    let id = '';
    const ok = await mutate(async () => {
      id = (await api<{ id: string }>('/digital-products', { method: 'POST', json: v })).id;
    }, 'Digital product created');
    if (ok) {
      setOpen(false);
      onCreated(id);
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> New digital product</Button></DialogTrigger>
      <DialogContent title="New digital product" description="Upload the file on the next screen. Map the Shopify variant so paid orders grant access automatically.">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Title" error={e.title?.message}><Input {...form.register('title')} /></Field>
          <Field label="Description"><Textarea {...form.register('description', optional)} /></Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="SKU" error={e.sku?.message}><Input {...form.register('sku')} /></Field>
            <Field label="Price" error={e.price?.message}><Input inputMode="decimal" {...form.register('price')} placeholder="12.00" /></Field>
            <Field label="Currency" error={e.currency?.message}><Input {...form.register('currency')} /></Field>
            <Field label="Max downloads" error={e.maxDownloads?.message}><Input type="number" {...form.register('maxDownloads', { valueAsNumber: true })} /></Field>
            <Field label="Access days" error={e.accessDays?.message}><Input type="number" {...form.register('accessDays', { valueAsNumber: true })} /></Field>
          </div>
          <Field label="Shopify variant ID" hint="gid://shopify/ProductVariant/…"><Input {...form.register('shopifyVariantId', optional)} /></Field>
          <div className="flex justify-end"><Button type="submit" disabled={form.formState.isSubmitting}>Create</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function DigitalPage() {
  const router = useRouter();
  const list = useList<DigitalProductRow>('/digital-products');
  return (
    <>
      <PageHeader title="Digital Delivery" description="Private files, verified payments, expiring and limited download links." actions={<CreateDigitalDialog onCreated={(id) => router.push(`/digital/${id}`)} />} />
      <Card>
        <div className="border-b p-3"><SearchInput value={list.q} onChange={list.setSearch} placeholder="Search products" /></div>
        <DataTable
          rows={list.data?.items}
          isLoading={list.isLoading}
          error={list.error}
          rowKey={(d) => d.id}
          onRowClick={(d) => router.push(`/digital/${d.id}`)}
          pagination={list.pagination}
          empty={{ title: 'No digital products yet', description: 'Create one and upload its file.' }}
          columns={[
            { header: 'Product', cell: (d) => <span className="font-medium">{d.product.title}</span> },
            { header: 'SKU', cell: (d) => <span className="font-mono text-xs">{d.product.variants[0]?.sku}</span> },
            { header: 'Price', cell: (d) => (d.product.variants[0] ? formatMoney(d.product.variants[0].price, d.product.variants[0].currency) : '—'), className: 'text-right tabular' },
            { header: 'Current file', cell: (d) => (d.assets[0] ? `v${d.assets[0].version} · ${d.assets[0].fileName}` : <StatusBadge status="PENDING" />) },
            { header: 'Access', cell: (d) => `${d.maxDownloads} downloads · ${d.accessDays} days` },
            { header: 'Entitlements', cell: (d) => d._count.entitlements, className: 'text-right tabular' },
          ]}
        />
      </Card>
    </>
  );
}
