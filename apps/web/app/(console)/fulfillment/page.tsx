'use client';
import Link from 'next/link';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable } from '@/components/data-table';
import { mutate } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useApi } from '@/hooks/use-api';
import { useList } from '@/hooks/use-list';
import { useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney, humanize } from '@/lib/format';
import type { FulfillmentRow } from '@/types/api';

const FILTERS = ['', 'AWAITING_APPROVAL', 'SUBMITTING', 'SUBMITTED', 'IN_PRODUCTION', 'SHIPPED', 'NEEDS_REVIEW', 'FAILED', 'CANCELLED'];

export default function FulfillmentPage() {
  const list = useList<FulfillmentRow>('/fulfillment');
  const { data: counts } = useApi<{ statusCounts: Record<string, number> }>('/fulfillment?pageSize=1');
  const { data: integrations } = useApi<{ provider: string; credential: { status: string } | null }[]>('/integrations');
  const { data: org } = useApi<{ demoMode: boolean; fulfillmentRequiresApproval: boolean }>('/organization');
  const { can } = useSession();
  const printful = integrations?.find((i) => i.provider === 'PRINTFUL')?.credential?.status ?? 'DISCONNECTED';

  const act = (row: FulfillmentRow, kind: 'submit' | 'retry') =>
    mutate(() => api(`/fulfillment/${row.id}/${kind}`, { method: 'POST', json: { confirm: true } }), kind === 'submit' ? 'Submitted to Printful' : 'Retry queued').then(() => list.mutate());

  return (
    <>
      <PageHeader
        title="POD Fulfillment"
        description="Paid POD orders become fulfillment tasks. Live submission to Printful always needs an explicit approval."
        actions={<><span className="text-xs text-muted-foreground">Printful</span><StatusBadge status={printful} />{org?.demoMode && <StatusBadge status="DEMO_MODE" />}</>}
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((s) => (
          <Button key={s || 'all'} size="sm" variant={(list.filters.status ?? '') === s ? 'default' : 'outline'} onClick={() => list.setFilter('status', s)}>
            {s ? humanize(s) : 'All'}{s && counts?.statusCounts[s] ? ` · ${counts.statusCounts[s]}` : ''}
          </Button>
        ))}
      </div>
      <Card>
        <div className="border-b p-3"><SearchInput value={list.q} onChange={list.setSearch} placeholder="Order number" /></div>
        <DataTable
          rows={list.data?.items}
          isLoading={list.isLoading}
          error={list.error}
          rowKey={(f) => f.id}
          pagination={list.pagination}
          empty={{ title: 'Fulfillment queue is empty', description: 'Tasks appear when a paid order with mapped POD items arrives.' }}
          columns={[
            { header: 'Order', cell: (f) => <Link className="font-medium hover:underline" href={`/orders/${f.order.id}`}>{f.order.orderNumber}</Link> },
            { header: 'Status', cell: (f) => <StatusBadge status={f.status} /> },
            { header: 'Printful #', cell: (f) => f.externalId ?? '—' },
            { header: 'Cost', cell: (f) => (f.currency ? formatMoney((Number(f.productionCost ?? 0) + Number(f.shippingCost ?? 0)).toFixed(2), f.currency) : '—'), className: 'text-right tabular' },
            { header: 'Tracking', cell: (f) => (f.trackingNumber ? <a className="text-primary hover:underline" href={f.trackingUrl ?? '#'} target="_blank" rel="noreferrer">{f.carrier} {f.trackingNumber}</a> : '—') },
            { header: 'Last event', cell: (f) => <span className="text-xs text-muted-foreground" title={f.lastError ?? undefined}>{f.lastError ?? (f.events[0] ? `${f.events[0].type} · ${formatDateTime(f.events[0].createdAt)}` : '—')}</span> },
            {
              header: '',
              cell: (f) =>
                !can('fulfillment:approve') ? null : ['AWAITING_APPROVAL', 'APPROVED'].includes(f.status) ? (
                  <ConfirmDialog
                    trigger={<Button size="sm">Approve & submit</Button>}
                    title={`Submit ${f.order.orderNumber} to Printful?`}
                    description={<>This creates and confirms a <strong>live, billable</strong> Printful order. Eligibility (payment, address, variant mapping) is re-checked before submission.</>}
                    confirmLabel="Submit live order"
                    onConfirm={() => act(f, 'submit')}
                  />
                ) : ['FAILED', 'NEEDS_REVIEW'].includes(f.status) ? (
                  <ConfirmDialog
                    trigger={<Button size="sm" variant="outline">Retry</Button>}
                    title="Retry submission?"
                    description="The retry first looks up the order at Printful by its idempotency key and adopts it if it already exists, so it cannot create a duplicate."
                    confirmLabel="Retry"
                    onConfirm={() => act(f, 'retry')}
                  />
                ) : null,
            },
          ]}
        />
      </Card>
    </>
  );
}
