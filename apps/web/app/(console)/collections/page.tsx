'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { collectionCreateSchema } from '@cfe/validation';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { DataTable } from '@/components/data-table';
import { Field, mutate, optional } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';

type Collection = { id: string; name: string; description: string | null; _count: { designs: number } };

export default function CollectionsPage() {
  const { data, error, isLoading, mutate: reload } = useApi<Collection[]>('/collections');
  const form = useForm<z.input<typeof collectionCreateSchema>>({ resolver: zodResolver(collectionCreateSchema) });
  const submit = form.handleSubmit(async (values) => {
    if (await mutate(() => api('/collections', { method: 'POST', json: values }), 'Collection created')) {
      form.reset({ name: '', description: '' });
      reload();
    }
  });
  return (
    <>
      <PageHeader title="Collections" description="Group designs into themes and drops." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <DataTable
            rows={data}
            isLoading={isLoading}
            error={error}
            rowKey={(c) => c.id}
            empty={{ title: 'No collections yet', description: 'Create one with the form.' }}
            columns={[
              { header: 'Name', cell: (c) => <Link className="font-medium hover:underline" href={`/designs?collectionId=${c.id}`}>{c.name}</Link> },
              { header: 'Description', cell: (c) => c.description ?? '—' },
              { header: 'Designs', cell: (c) => c._count.designs, className: 'text-right tabular' },
            ]}
          />
        </Card>
        <Card>
          <CardHeader><CardTitle>New collection</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={submit} className="space-y-4">
              <Field label="Name" error={form.formState.errors.name?.message}><Input {...form.register('name')} /></Field>
              <Field label="Description"><Input {...form.register('description', optional)} /></Field>
              <Button type="submit" disabled={form.formState.isSubmitting}>Create</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
