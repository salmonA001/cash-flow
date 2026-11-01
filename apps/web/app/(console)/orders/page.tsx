'use client';
import { useRouter } from 'next/navigation';
import { DataTable } from '@/components/data-table';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { useList } from '@/hooks/use-list';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { OrderSummary } from '@/types/api';

export default function OrdersPage() {
  const router = useRouter();
  const list = useList<OrderSummary>('/orders');
  return (
    <>
      <PageHeader title="Orders" description="Shopify orders synced from authoritative store data." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <SearchInput value={list.q} onChange={list.setSearch} placeholder="Order # or customer email" />
          <Select aria-label="Payment status" className="w-44" value={list.filters.paymentStatus ?? ''} onChange={(e) => list.setFilter('paymentStatus', e.target.value)}>
            <option value="">All payments</option>
            {['PENDING', 'PAID', 'PARTIALLY_REFUNDED', 'REFUNDED', 'VOIDED', 'FAILED'].map((s) => <option key={s} value={s}>{s.replace('_', ' ').toLowerCase()}</option>)}
          </Select>
          <Select aria-label="Item type" className="w-40" value={list.filters.itemType ?? ''} onChange={(e) => list.setFilter('itemType', e.target.value)}>
            <option value="">All items</option><option value="POD">Has POD</option><option value="DIGITAL">Has digital</option><option value="UNCLASSIFIED">Has unmapped</option>
          </Select>
        </div>
        <DataTable
          rows={list.data?.items}
          isLoading={list.isLoading}
          error={list.error}
          rowKey={(o) => o.id}
          onRowClick={(o) => router.push(`/orders/${o.id}`)}
          pagination={list.pagination}
          empty={{ title: 'No orders', description: 'Orders arrive from Shopify webhooks and the hourly reconciliation.' }}
          columns={[
            { header: 'Order', cell: (o) => <span className="font-medium">{o.orderNumber}</span> },
            { header: 'Placed', cell: (o) => formatDateTime(o.placedAt) },
            { header: 'Customer', cell: (o) => o.customer?.email ?? '—' },
            { header: 'Items', cell: (o) => <div className="flex gap-1">{[...new Set(o.items.map((i) => i.itemType))].map((t) => <Badge key={t} tone={t === 'UNCLASSIFIED' ? 'warning' : 'neutral'}>{t.toLowerCase()}</Badge>)}</div> },
            { header: 'Payment', cell: (o) => <StatusBadge status={o.paymentStatus} /> },
            { header: 'Fulfillment', cell: (o) => (o.fulfillments[0] ? <StatusBadge status={o.fulfillments[0].status} /> : '—') },
            { header: 'Total', cell: (o) => formatMoney(o.total, o.currency), className: 'text-right tabular' },
          ]}
        />
      </Card>
    </>
  );
}
