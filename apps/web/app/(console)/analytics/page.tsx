'use client';
import { Download } from 'lucide-react';
import { useState } from 'react';
import { GroupedBarChart } from '@/components/charts/charts';
import { DataTable } from '@/components/data-table';
import { DateRange, defaultRange } from '@/components/date-range';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApi } from '@/hooks/use-api';
import { qs } from '@/lib/api';
import { downloadCsv, formatMoney } from '@/lib/format';
import type { MonthlyPoint } from '@/types/api';

type DesignPerf = { designId: string; title: string; currency: string; shopifySales: string; shopifyUnits: number; royalties: string; merchUnits: number };
type ProductPerf = { productId: string; title: string; type: string; currency: string; sales: string; units: number; orders: number };

export default function AnalyticsPage() {
  const [range, setRange] = useState(defaultRange);
  const q = qs(range);
  const revenue = useApi<{ baseCurrency: string; series: MonthlyPoint[] }>(`/finance/revenue${q}`);
  const designs = useApi<DesignPerf[]>(`/analytics/designs${q}`);
  const products = useApi<ProductPerf[]>(`/analytics/products${q}`);

  return (
    <>
      <PageHeader title="Analytics" description="Performance by design, product and channel." actions={<DateRange {...range} onChange={setRange} />} />
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <div><CardTitle>Sales, royalties and expenses</CardTitle><CardDescription>Monthly, in base currency</CardDescription></div>
            <Button variant="outline" size="sm" disabled={!revenue.data?.series.length} onClick={() => downloadCsv('revenue-trend.csv', revenue.data!.series as unknown as Record<string, unknown>[])}><Download /> CSV</Button>
          </CardHeader>
          <CardContent>
            {revenue.error ? <ErrorState error={revenue.error} /> : !revenue.data ? <LoadingRows rows={4} /> : revenue.data.series.length === 0 ? <EmptyState title="No data in this range" /> : (
              <GroupedBarChart data={revenue.data.series as unknown as Record<string, string>[]} xKey="month" currency={revenue.data.baseCurrency} height={300}
                series={[{ key: 'shopifySales', label: 'Shopify' }, { key: 'amazonRoyalties', label: 'Amazon royalties' }, { key: 'digitalSales', label: 'Digital' }, { key: 'expenses', label: 'Expenses' }]} />
            )}
          </CardContent>
        </Card>
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <div><CardTitle>Best-performing designs</CardTitle><CardDescription>Store sales and Merch royalties, per currency</CardDescription></div>
              <Button variant="outline" size="sm" disabled={!designs.data?.length} onClick={() => downloadCsv('designs.csv', designs.data!)}><Download /> CSV</Button>
            </CardHeader>
            <DataTable rows={designs.data} isLoading={designs.isLoading} error={designs.error} rowKey={(d) => d.designId + d.currency} empty={{ title: 'No design sales in this range' }}
              columns={[
                { header: 'Design', cell: (d) => <span className="font-medium">{d.title}</span> },
                { header: 'Store units', cell: (d) => d.shopifyUnits, className: 'text-right tabular' },
                { header: 'Store sales', cell: (d) => formatMoney(d.shopifySales, d.currency), className: 'text-right tabular' },
                { header: 'Merch units', cell: (d) => d.merchUnits, className: 'text-right tabular' },
                { header: 'Royalties', cell: (d) => formatMoney(d.royalties, d.currency), className: 'text-right tabular' },
              ]} />
          </Card>
          <Card>
            <CardHeader>
              <div><CardTitle>Best-performing products</CardTitle><CardDescription>Shopify store, per currency</CardDescription></div>
              <Button variant="outline" size="sm" disabled={!products.data?.length} onClick={() => downloadCsv('products.csv', products.data!)}><Download /> CSV</Button>
            </CardHeader>
            <DataTable rows={products.data} isLoading={products.isLoading} error={products.error} rowKey={(p) => p.productId + p.currency} empty={{ title: 'No product sales in this range' }}
              columns={[
                { header: 'Product', cell: (p) => <span className="font-medium">{p.title}</span> },
                { header: 'Type', cell: (p) => p.type },
                { header: 'Orders', cell: (p) => p.orders, className: 'text-right tabular' },
                { header: 'Units', cell: (p) => p.units, className: 'text-right tabular' },
                { header: 'Sales', cell: (p) => formatMoney(p.sales, p.currency), className: 'text-right tabular' },
              ]} />
          </Card>
        </div>
      </div>
    </>
  );
}
