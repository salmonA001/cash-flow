'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { listingCreateSchema } from '@cfe/validation';
import { ExternalLink, Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { DataTable } from '@/components/data-table';
import { Field, mutate, optional } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { useApi } from '@/hooks/use-api';
import { useList } from '@/hooks/use-list';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { Design, Listing, Paginated, Product } from '@/types/api';

const STATUSES = ['DRAFT', 'PENDING', 'LIVE', 'REJECTED', 'REMOVED'];

function CreateListingDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const { data: designs } = useApi<Paginated<Design>>(open ? '/designs?status=APPROVED&pageSize=100' : null);
  const { data: products } = useApi<Paginated<Product>>(open ? '/products?pageSize=100' : null);
  const form = useForm<z.input<typeof listingCreateSchema>>({ resolver: zodResolver(listingCreateSchema), defaultValues: { channel: 'AMAZON_MERCH', marketplace: 'amazon.com', status: 'DRAFT' } });
  const channel = form.watch('channel');
  const errors = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    const ok = await mutate(() => api('/listings', { method: 'POST', json: v }), 'Listing created');
    if (ok) {
      setOpen(false);
      form.reset();
      onCreated();
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> New listing</Button></DialogTrigger>
      <DialogContent title="New listing reference" description="Record where a design or product is listed. Only approved designs can be listed.">
        <form onSubmit={submit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Channel">
              <Select {...form.register('channel')}><option value="AMAZON_MERCH">Amazon Merch</option><option value="SHOPIFY">Shopify</option></Select>
            </Field>
            <Field label="Marketplace" error={errors.marketplace?.message} hint="e.g. amazon.com, amazon.de, shopify"><Input {...form.register('marketplace')} /></Field>
            <Field label={channel === 'AMAZON_MERCH' ? 'ASIN' : 'Shopify product ID'} error={errors.externalId?.message}><Input {...form.register('externalId')} /></Field>
            <Field label="Country" hint="2-letter, optional"><Input maxLength={2} {...form.register('country', optional)} /></Field>
            <Field label={`Design${channel === 'AMAZON_MERCH' ? ' (required)' : ''}`}>
              <Select {...form.register('designId', optional)}><option value="">— None —</option>{designs?.items.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}</Select>
            </Field>
            <Field label={`Product${channel === 'SHOPIFY' ? ' (required)' : ''}`}>
              <Select {...form.register('productId', optional)}><option value="">— None —</option>{products?.items.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}</Select>
            </Field>
            <Field label="Status"><Select {...form.register('status')}>{STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</Select></Field>
            <Field label="URL" error={errors.url?.message}><Input {...form.register('url', optional)} placeholder="https://" /></Field>
          </div>
          <div className="flex justify-end"><Button type="submit" disabled={form.formState.isSubmitting}>Create listing</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ListingsPage() {
  const list = useList<Listing>('/listings');
  const setStatus = (l: Listing, status: string) => mutate(() => api(`/listings/${l.id}`, { method: 'PATCH', json: { status } }), 'Listing updated').then(() => list.mutate());
  return (
    <>
      <PageHeader title="Listings" description="Amazon Merch and Shopify listing references mapped to designs." actions={<CreateListingDialog onCreated={() => list.mutate()} />} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <SearchInput value={list.q} onChange={list.setSearch} placeholder="Search ASIN or design" />
          <Select aria-label="Channel" className="w-40" value={list.filters.channel ?? ''} onChange={(e) => list.setFilter('channel', e.target.value)}>
            <option value="">All channels</option><option value="AMAZON_MERCH">Amazon Merch</option><option value="SHOPIFY">Shopify</option>
          </Select>
        </div>
        <DataTable
          rows={list.data?.items}
          isLoading={list.isLoading}
          error={list.error}
          rowKey={(l) => l.id}
          pagination={list.pagination}
          empty={{ title: 'No listings yet', description: 'Add Amazon Merch ASINs here so imported royalties map to designs.' }}
          columns={[
            { header: 'Channel', cell: (l) => (l.channel === 'AMAZON_MERCH' ? 'Amazon Merch' : 'Shopify') },
            { header: 'Marketplace', cell: (l) => `${l.marketplace}${l.country ? ` · ${l.country}` : ''}` },
            { header: 'External ID', cell: (l) => <span className="font-mono text-xs">{l.externalId}</span> },
            { header: 'Design / product', cell: (l) => l.design?.title ?? l.product?.title ?? '—' },
            {
              header: 'Status',
              cell: (l) => (
                <Select aria-label="Listing status" className="h-8 w-32 text-xs" value={l.status} onChange={(e) => setStatus(l, e.target.value)}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
                </Select>
              ),
            },
            { header: 'Royalties', cell: (l) => (l.royalties.length ? l.royalties.map((r) => `${formatMoney(r.amount, r.currency)} (${r.units})`).join(' · ') : '—'), className: 'tabular' },
            { header: '', cell: (l) => l.url && <a href={l.url} target="_blank" rel="noreferrer" aria-label="Open listing" className="text-muted-foreground hover:text-foreground"><ExternalLink className="size-4" /></a> },
          ]}
        />
      </Card>
    </>
  );
}
