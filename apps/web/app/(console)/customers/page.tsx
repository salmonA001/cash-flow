'use client';
import { useRouter } from 'next/navigation';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { Card } from '@/components/ui/card';
import { useList } from '@/hooks/use-list';
import { formatDate } from '@/lib/format';

type Customer = { id: string; email: string | null; name: string | null; country: string | null; createdAt: string; _count: { orders: number } };

export default function CustomersPage() {
  const router = useRouter();
  const list = useList<Customer>('/customers');
  return (
    <>
      <PageHeader title="Customers" description="Synced from Shopify orders." />
      <Card>
        <div className="border-b p-3"><SearchInput value={list.q} onChange={list.setSearch} placeholder="Email or name" /></div>
        <DataTable
          rows={list.data?.items}
          isLoading={list.isLoading}
          error={list.error}
          rowKey={(c) => c.id}
          onRowClick={(c) => router.push(`/customers/${c.id}`)}
          pagination={list.pagination}
          empty={{ title: 'No customers yet', description: 'Customers are created when their first order syncs.' }}
          columns={[
            { header: 'Name', cell: (c) => <span className="font-medium">{c.name ?? '—'}</span> },
            { header: 'Email', cell: (c) => c.email ?? '—' },
            { header: 'Country', cell: (c) => c.country ?? '—' },
            { header: 'Orders', cell: (c) => c._count.orders, className: 'text-right tabular' },
            { header: 'Since', cell: (c) => formatDate(c.createdAt) },
          ]}
        />
      </Card>
    </>
  );
}
