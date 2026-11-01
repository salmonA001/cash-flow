'use client';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { mutate } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { Paginated, Product } from '@/types/api';

interface OrderDetail {
  id: string; orderNumber: string; currency: string; status: string; paymentStatus: string; placedAt: string;
  subtotal: string; shippingTotal: string; taxTotal: string; discountTotal: string; total: string;
  shippingAddress: Record<string, string | null> | null;
  customer: { id: string; email: string | null; name: string | null } | null;
  items: {
    id: string; title: string; sku: string | null; quantity: number; unitPrice: string; totalDiscount: string; itemType: string;
    variant: { id: string; sku: string; product: { id: string; title: string; type: string } } | null;
    entitlement: { id: string; status: string; downloadCount: number; maxDownloads: number; expiresAt: string } | null;
  }[];
  payments: { id: string; provider: string; amount: string; fee: string; currency: string; status: string; processedAt: string }[];
  refunds: { id: string; amount: string; currency: string; reason: string | null; processedAt: string }[];
  fulfillments: { id: string; status: string; trackingNumber: string | null; trackingUrl: string | null; events: { id: string; type: string; message: string | null; createdAt: string }[] }[];
}

export default function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: order, error, mutate: reload } = useApi<OrderDetail>(`/orders/${id}`);
  const hasUnmapped = !!order?.items.some((i) => i.itemType === 'UNCLASSIFIED');
  const { data: products } = useApi<Paginated<Product>>(hasUnmapped ? '/products?pageSize=100' : null);
  const [mapping, setMapping] = useState<Record<string, string>>({});

  if (error) return <ErrorState error={error} />;
  if (!order) return <LoadingRows rows={8} />;
  const variants = (products?.items ?? []).flatMap((p) => p.variants.map((v) => ({ id: v.id, label: `${p.title} · ${v.sku}` })));
  const digitalProductFor = (productId: string) => api<Product & { digitalProduct: { id: string } | null }>(`/products/${productId}`).then((p) => p.digitalProduct!.id);

  return (
    <>
      <Button asChild variant="link" size="sm" className="mb-2"><Link href="/orders"><ArrowLeft /> Orders</Link></Button>
      <PageHeader title={`Order ${order.orderNumber}`} description={formatDateTime(order.placedAt)} actions={<><StatusBadge status={order.status} /><StatusBadge status={order.paymentStatus} /></>} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>Line items</CardTitle></CardHeader>
            <CardContent className="px-0 pb-2">
              <Table>
                <THead><tr><TH>Item</TH><TH>Type</TH><TH className="text-right">Qty</TH><TH className="text-right">Price</TH><TH>Mapping / delivery</TH></tr></THead>
                <TBody>
                  {order.items.map((i) => (
                    <TR key={i.id}>
                      <TD><p className="font-medium">{i.title}</p><p className="font-mono text-xs text-muted-foreground">{i.sku ?? 'no SKU'}</p></TD>
                      <TD><StatusBadge status={i.itemType} /></TD>
                      <TD className="text-right tabular">{i.quantity}</TD>
                      <TD className="text-right tabular">{formatMoney(i.unitPrice, order.currency)}</TD>
                      <TD>
                        {i.itemType === 'UNCLASSIFIED' ? (
                          <Select aria-label={`Map ${i.title}`} className="h-8 text-xs" value={mapping[i.id] ?? ''} onChange={(e) => setMapping((m) => ({ ...m, [i.id]: e.target.value }))}>
                            <option value="">Map to variant…</option>
                            {variants.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                          </Select>
                        ) : i.entitlement ? (
                          <span className="text-xs"><StatusBadge status={i.entitlement.status} /> {i.entitlement.downloadCount}/{i.entitlement.maxDownloads} downloads</span>
                        ) : i.itemType === 'DIGITAL' && order.paymentStatus === 'PAID' && i.variant ? (
                          <Button size="sm" variant="outline" onClick={async () => {
                            const dpId = await digitalProductFor(i.variant!.product.id);
                            await mutate(() => api(`/downloads/${dpId}/grant`, { method: 'POST', json: { orderItemId: i.id } }), 'Download grant queued — the customer will be emailed');
                            reload();
                          }}>Grant download</Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">{i.variant?.product.title ?? '—'}</span>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
              {Object.keys(mapping).length > 0 && (
                <div className="flex justify-end px-5 pt-3">
                  <Button onClick={async () => {
                    const itemMappings = Object.entries(mapping).filter(([, v]) => v).map(([orderItemId, variantId]) => ({ orderItemId, variantId }));
                    if (await mutate(() => api(`/orders/${id}`, { method: 'PATCH', json: { itemMappings } }), 'Items mapped — workflow re-run queued')) {
                      setMapping({});
                      reload();
                    }
                  }}>Save mappings</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Timeline</CardTitle></CardHeader>
            <CardContent>
              <ol className="space-y-3 border-l pl-4 text-sm">
                <li><p className="font-medium">Order placed</p><p className="text-xs text-muted-foreground">{formatDateTime(order.placedAt)}</p></li>
                {order.payments.map((p) => <li key={p.id}><p className="font-medium">Payment {p.status.toLowerCase()} · {formatMoney(p.amount, p.currency)} <span className="text-muted-foreground">(fee {formatMoney(p.fee, p.currency)})</span></p><p className="text-xs text-muted-foreground">{p.provider} · {formatDateTime(p.processedAt)}</p></li>)}
                {order.fulfillments.flatMap((f) => f.events).map((e) => <li key={e.id}><p className="font-medium">Fulfillment: {e.type}</p><p className="text-xs text-muted-foreground">{e.message} · {formatDateTime(e.createdAt)}</p></li>)}
                {order.refunds.map((r) => <li key={r.id}><p className="font-medium text-destructive">Refund {formatMoney(r.amount, r.currency)}</p><p className="text-xs text-muted-foreground">{r.reason ?? 'No reason'} · {formatDateTime(r.processedAt)}</p></li>)}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Totals</CardTitle></CardHeader>
            <CardContent className="space-y-1.5 text-sm tabular">
              {([['Subtotal', order.subtotal], ['Discounts', `-${order.discountTotal}`], ['Shipping', order.shippingTotal], ['Tax', order.taxTotal]] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span>{formatMoney(v, order.currency)}</span></div>
              ))}
              <div className="flex justify-between border-t pt-2 font-semibold"><span>Total</span><span>{formatMoney(order.total, order.currency)}</span></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Customer</CardTitle></CardHeader>
            <CardContent className="text-sm">
              {order.customer ? <Link className="hover:underline" href={`/customers/${order.customer.id}`}>{order.customer.name ?? order.customer.email}</Link> : '—'}
              <p className="text-muted-foreground">{order.customer?.email}</p>
              {order.shippingAddress && (
                <address className="mt-3 not-italic text-muted-foreground">
                  {[order.shippingAddress.name, order.shippingAddress.address1, order.shippingAddress.address2, [order.shippingAddress.city, order.shippingAddress.provinceCode, order.shippingAddress.zip].filter(Boolean).join(' '), order.shippingAddress.countryCode].filter(Boolean).map((l, i) => <div key={i}>{l}</div>)}
                </address>
              )}
            </CardContent>
          </Card>
          {order.fulfillments.map((f) => (
            <Card key={f.id}>
              <CardHeader><CardTitle>Fulfillment</CardTitle><StatusBadge status={f.status} /></CardHeader>
              <CardContent className="text-sm">
                {f.trackingNumber ? <a className="text-primary hover:underline" href={f.trackingUrl ?? '#'} target="_blank" rel="noreferrer">Track {f.trackingNumber}</a> : <span className="text-muted-foreground">No tracking yet</span>}
                <div className="mt-2"><Button asChild size="sm" variant="outline"><Link href="/fulfillment">Open fulfillment queue</Link></Button></div>
              </CardContent>
            </Card>
          ))}
          {order.items.some((i) => i.entitlement?.status === 'ACTIVE') && (
            <ConfirmDialog
              trigger={<Button variant="outline" className="w-full">Revoke all downloads</Button>}
              title="Revoke download access?"
              description="The customer's download links stop working immediately."
              confirmLabel="Revoke"
              destructive
              onConfirm={async () => {
                for (const i of order.items.filter((x) => x.entitlement?.status === 'ACTIVE')) {
                  await mutate(() => api(`/downloads/${i.entitlement!.id}/revoke`, { method: 'POST', json: { reason: 'Revoked from order page' } }), 'Access revoked');
                }
                reload();
              }}
            />
          )}
        </div>
      </div>
    </>
  );
}
