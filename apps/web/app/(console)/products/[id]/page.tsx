'use client';
import { ArrowLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { Field, mutate } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useApi } from '@/hooks/use-api';
import { api } from '@/lib/api';
import { formatMoney } from '@/lib/format';
import type { DesignDetail, Product, Variant } from '@/types/api';

function VariantMappingDialog({ productId, variant, printFiles, onClose }: { productId: string; variant: Variant; printFiles: { id: string; label: string }[]; onClose: () => void }) {
  const [printfulVariantId, setPrintful] = useState(variant.printfulVariantId?.toString() ?? '');
  const [printFileAssetId, setPrintFile] = useState(variant.printFileAssetId ?? '');
  const [shopifyVariantId, setShopify] = useState(variant.shopifyVariantId ?? '');
  const [productionCost, setCost] = useState(variant.productionCost ?? '');
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent title={`Map ${variant.sku}`} description="Fulfillment requires a Printful catalog variant and a print file.">
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const ok = await mutate(
              () => api(`/products/${productId}/variants/${variant.id}`, {
                method: 'PATCH',
                json: {
                  printfulVariantId: printfulVariantId ? Number(printfulVariantId) : undefined,
                  printFileAssetId: printFileAssetId || undefined,
                  shopifyVariantId: shopifyVariantId || undefined,
                  productionCost: productionCost || undefined,
                },
              }),
              'Variant mapping saved',
            );
            if (ok) onClose();
          }}
        >
          <Field label="Printful variant ID" hint="From the Printful catalog (e.g. 4012)"><Input inputMode="numeric" value={printfulVariantId} onChange={(e) => setPrintful(e.target.value)} /></Field>
          <Field label="Print file">
            <Select value={printFileAssetId} onChange={(e) => setPrintFile(e.target.value)}>
              <option value="">— Select —</option>
              {printFiles.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
            </Select>
          </Field>
          <Field label="Shopify variant ID" hint="gid://shopify/ProductVariant/…"><Input value={shopifyVariantId} onChange={(e) => setShopify(e.target.value)} /></Field>
          <Field label="Expected production cost"><Input inputMode="decimal" value={productionCost} onChange={(e) => setCost(e.target.value)} placeholder="11.50" /></Field>
          <div className="flex justify-end"><Button type="submit">Save mapping</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProductDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: product, error, mutate: reload } = useApi<Product>(`/products/${id}`);
  const { data: design } = useApi<DesignDetail>(product?.designId ? `/designs/${product.designId}` : null);
  const [editing, setEditing] = useState<Variant | null>(null);

  if (error) return <ErrorState error={error} />;
  if (!product) return <LoadingRows rows={6} />;

  const printFiles = (design?.versions ?? []).flatMap((v) => v.assets.filter((a) => a.kind === 'PRINT_FILE').map((a) => ({ id: a.id, label: `v${v.versionNumber} · ${a.fileName}` })));
  const setStatus = (status: string) => mutate(() => api(`/products/${id}`, { method: 'PATCH', json: { status } }), 'Status updated').then(() => reload());

  return (
    <>
      <Button asChild variant="link" size="sm" className="mb-2"><Link href="/products"><ArrowLeft /> Products</Link></Button>
      <PageHeader
        title={product.title}
        description={product.design ? `Design: ${product.design.title}` : 'No design assigned'}
        actions={
          <>
            <StatusBadge status={product.status} />
            <Select aria-label="Change status" className="w-36" value={product.status} onChange={(e) => setStatus(e.target.value)}>
              <option value="DRAFT">Draft</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option>
            </Select>
          </>
        }
      />
      <Card>
        <CardHeader><div><CardTitle>Variants & fulfillment mapping</CardTitle><CardDescription>Orders for unmapped variants are held for review, never guessed.</CardDescription></div></CardHeader>
        <CardContent className="px-0 pb-2">
          <Table>
            <THead><tr><TH>SKU</TH><TH>Size</TH><TH>Color</TH><TH className="text-right">Price</TH><TH className="text-right">Exp. cost</TH><TH>Printful</TH><TH>Print file</TH><TH>Shopify</TH><TH /></tr></THead>
            <TBody>
              {product.variants.map((v) => (
                <TR key={v.id}>
                  <TD className="font-mono text-xs">{v.sku}</TD>
                  <TD>{v.size ?? '—'}</TD>
                  <TD>{v.color ?? '—'}</TD>
                  <TD className="text-right tabular">{formatMoney(v.price, v.currency)}</TD>
                  <TD className="text-right tabular">{v.productionCost ? formatMoney(v.productionCost, v.currency) : '—'}</TD>
                  <TD>{v.printfulVariantId ?? <StatusBadge status="UNCLASSIFIED" />}</TD>
                  <TD>{v.printFileAssetId ? <StatusBadge status="CONNECTED" /> : <StatusBadge status="PENDING" />}</TD>
                  <TD className="max-w-40 truncate text-xs" title={v.shopifyVariantId ?? ''}>{v.shopifyVariantId ?? '—'}</TD>
                  <TD><Button variant="ghost" size="sm" onClick={() => setEditing(v)}><Pencil /> Map</Button></TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </CardContent>
      </Card>
      {editing && <VariantMappingDialog productId={id} variant={editing} printFiles={printFiles} onClose={() => { setEditing(null); reload(); }} />}
    </>
  );
}
