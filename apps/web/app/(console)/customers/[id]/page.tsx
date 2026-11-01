'use client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { use } from 'react';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/use-api';
import { formatDate, formatMoney } from '@/lib/format';

interface CustomerDetail {
  name: string | null; email: string | null; country: string | null;
  orders: { id: string; orderNumber: string; total: string; currency: string; paymentStatus: string; placedAt: string }[];
  entitlements: { id: string; status: string; digitalProduct: { product: { title: string } } }[];
}

export default function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useApi<CustomerDetail>(`/customers/${id}`);
  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingRows rows={5} />;
  return (
    <>
      <Button asChild variant="link" size="sm" className="mb-2"><Link href="/customers"><ArrowLeft /> Customers</Link></Button>
      <PageHeader title={data.name ?? data.email ?? 'Customer'} description={[data.email, data.country].filter(Boolean).join(' · ')} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Orders</CardTitle></CardHeader>
          <CardContent className="pt-2">
            {data.orders.length === 0 ? <EmptyState title="No orders" /> : (
              <ul className="divide-y">{data.orders.map((o) => (
                <li key={o.id}><Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-2 py-2.5 text-sm hover:text-primary">
                  <span className="font-medium">{o.orderNumber}</span><span className="text-muted-foreground">{formatDate(o.placedAt)}</span><StatusBadge status={o.paymentStatus} /><span className="tabular">{formatMoney(o.total, o.currency)}</span>
                </Link></li>
              ))}</ul>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Digital access</CardTitle></CardHeader>
          <CardContent className="pt-2">
            {data.entitlements.length === 0 ? <EmptyState title="No downloads" /> : (
              <ul className="space-y-2 text-sm">{data.entitlements.map((e) => <li key={e.id} className="flex justify-between gap-2"><span className="truncate">{e.digitalProduct.product.title}</span><StatusBadge status={e.status} /></li>)}</ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
