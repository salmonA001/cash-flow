'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { designCreateSchema } from '@cfe/validation';
import { Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { DataTable } from '@/components/data-table';
import { Field, mutate, optional } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Select, Textarea } from '@/components/ui/input';
import { useApi } from '@/hooks/use-api';
import { useList } from '@/hooks/use-list';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Design } from '@/types/api';

type Collection = { id: string; name: string };

function CreateDesignDialog({ collections, onCreated }: { collections: Collection[]; onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<z.input<typeof designCreateSchema>>({ resolver: zodResolver(designCreateSchema), defaultValues: { tags: [], collectionIds: [] } });
  const [tagText, setTagText] = useState('');
  const submit = form.handleSubmit(async (values) => {
    let id = '';
    const ok = await mutate(async () => {
      const tags = tagText.split(',').map((t) => t.trim()).filter(Boolean);
      id = (await api<{ id: string }>('/designs', { method: 'POST', json: { ...values, tags } })).id;
    }, 'Design created');
    if (ok) {
      setOpen(false);
      onCreated(id);
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> New design</Button></DialogTrigger>
      <DialogContent title="New design" description="Create the design record, then upload artwork on its page.">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Title" error={form.formState.errors.title?.message}><Input {...form.register('title')} /></Field>
          <Field label="Description"><Textarea {...form.register('description', optional)} /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category"><Input {...form.register('category', optional)} placeholder="e.g. Animals" /></Field>
            <Field label="Tags" hint="Comma separated"><Input value={tagText} onChange={(e) => setTagText(e.target.value)} placeholder="cats, retro" /></Field>
          </div>
          {collections.length > 0 && (
            <Field label="Collections">
              <Select multiple className="h-24" {...form.register('collectionIds')}>
                {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          )}
          <div className="flex justify-end"><Button type="submit" disabled={form.formState.isSubmitting}>Create design</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function DesignsPage() {
  const router = useRouter();
  const collectionId = useSearchParams().get('collectionId');
  const list = useList<Design>('/designs', collectionId ? { collectionId } : {});
  const { data: collections = [] } = useApi<Collection[]>('/collections');
  return (
    <>
      <PageHeader title="Design Studio" description="Artwork, versions and approval status." actions={<CreateDesignDialog collections={collections} onCreated={(id) => router.push(`/designs/${id}`)} />} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <SearchInput value={list.q} onChange={list.setSearch} placeholder="Search title or tag" />
          <Select aria-label="Status" className="w-40" value={list.filters.status ?? ''} onChange={(e) => list.setFilter('status', e.target.value)}>
            <option value="">All statuses</option>
            {['DRAFT', 'IN_REVIEW', 'APPROVED', 'ARCHIVED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
          </Select>
          <Select aria-label="Collection" className="w-44" value={list.filters.collectionId ?? ''} onChange={(e) => list.setFilter('collectionId', e.target.value)}>
            <option value="">All collections</option>
            {collections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </div>
        <DataTable
          rows={list.data?.items}
          isLoading={list.isLoading}
          error={list.error}
          rowKey={(d) => d.id}
          onRowClick={(d) => router.push(`/designs/${d.id}`)}
          pagination={list.pagination}
          empty={{ title: 'No designs yet', description: 'Create your first design and upload its artwork.' }}
          columns={[
            { header: 'Title', cell: (d) => <span className="font-medium">{d.title}</span> },
            { header: 'Status', cell: (d) => <StatusBadge status={d.status} /> },
            { header: 'Tags', cell: (d) => <div className="flex flex-wrap gap-1">{d.tags.slice(0, 4).map((t) => <Badge key={t}>{t}</Badge>)}</div> },
            { header: 'Collections', cell: (d) => d.collections.map((c) => c.collection.name).join(', ') || '—' },
            { header: 'Versions', cell: (d) => d._count?.versions, className: 'text-right tabular' },
            { header: 'Products', cell: (d) => d._count?.products, className: 'text-right tabular' },
            { header: 'Listings', cell: (d) => d._count?.listings, className: 'text-right tabular' },
            { header: 'Updated', cell: (d) => formatDate(d.updatedAt) },
          ]}
        />
      </Card>
    </>
  );
}
