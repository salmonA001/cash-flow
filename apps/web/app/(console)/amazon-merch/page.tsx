'use client';
import { FileUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { mutate } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { SearchInput } from '@/components/search-input';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApi } from '@/hooks/use-api';
import { useList } from '@/hooks/use-list';
import { upload } from '@/lib/api';
import { downloadCsv, formatDate, formatDateTime, formatMoney } from '@/lib/format';

interface Preview {
  formatId: string;
  validRows: number;
  alreadyImported: number;
  duplicateRowsInFile: number[];
  errors: { rowNumber: number; field: string; message: string }[];
  sample: { rowNumber: number; transactionDate: string; asin: string; marketplace: string; unitsSold: number; royaltyAmount: string; currency: string; title: string | null }[];
}

interface ImportRecord {
  id: string; fileName: string; formatId: string; status: string; rowCount: number; importedCount: number; duplicateCount: number; errorCount: number; createdAt: string;
}

interface Royalty {
  id: string; transactionDate: string; asin: string; marketplace: string; title: string | null; unitsSold: number; unitsReturned: number; royaltyAmount: string; currency: string;
  listing: { design: { id: string; title: string } | null } | null;
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (path: string) => {
    const form = new FormData();
    form.append('file', file!);
    return upload<Preview>(path, form);
  };
  return (
    <Card>
      <CardHeader><div><CardTitle>Import a royalty report</CardTitle><CardDescription>Export the report from your Merch on Demand dashboard as CSV. Nothing is stored until you confirm.</CardDescription></div></CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Input type="file" accept=".csv" aria-label="Report CSV" className="max-w-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
          <Button variant="outline" disabled={!file || busy} onClick={async () => {
            setBusy(true);
            await mutate(async () => setPreview(await send('/amazon-merch/reports/preview')), 'Report validated');
            setBusy(false);
          }}>Validate</Button>
          <Button disabled={!preview || preview.validRows === 0 || busy} onClick={async () => {
            setBusy(true);
            const ok = await mutate(() => send('/amazon-merch/reports/import'), 'Import queued — royalties appear once processed');
            setBusy(false);
            if (ok) { setPreview(null); setFile(null); onImported(); }
          }}><FileUp /> Import</Button>
        </div>
        {preview && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-4 text-sm">
              <span>Format <strong>{preview.formatId}</strong></span>
              <span><strong>{preview.validRows}</strong> valid rows</span>
              <span><strong>{preview.alreadyImported}</strong> already imported (skipped)</span>
              <span><strong>{preview.duplicateRowsInFile.length}</strong> duplicates in file</span>
              <span className={preview.errors.length ? 'text-destructive' : ''}><strong>{preview.errors.length}</strong> errors</span>
            </div>
            {preview.errors.length > 0 && (
              <div className="max-h-48 overflow-auto rounded-xl border border-destructive/30 p-3 text-xs">
                {preview.errors.map((e, i) => <p key={i}>Row {e.rowNumber} · {e.field}: {e.message}</p>)}
              </div>
            )}
            <Table>
              <THead><tr><TH>Row</TH><TH>Date</TH><TH>ASIN</TH><TH>Marketplace</TH><TH className="text-right">Units</TH><TH className="text-right">Royalty</TH></tr></THead>
              <TBody>{preview.sample.map((r) => <TR key={r.rowNumber}><TD>{r.rowNumber}</TD><TD>{r.transactionDate}</TD><TD className="font-mono text-xs">{r.asin}</TD><TD>{r.marketplace}</TD><TD className="text-right tabular">{r.unitsSold}</TD><TD className="text-right tabular">{formatMoney(r.royaltyAmount, r.currency)}</TD></TR>)}</TBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function Summary() {
  const { data, error } = useApi<{
    byDesign: { designId: string | null; title: string | null; currency: string; royalties: string; units: number }[];
    byMonth: { month: string; currency: string; royalties: string; units: number }[];
    unmappedAsins: { asin: string; marketplace: string; units: number }[];
  }>('/amazon-merch/royalties/summary');
  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingRows />;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Royalties by month</CardTitle></CardHeader>
        <CardContent className="px-0 pb-2">
          {data.byMonth.length === 0 ? <EmptyState title="No royalties imported" /> : (
            <Table><THead><tr><TH>Month</TH><TH className="text-right">Units</TH><TH className="text-right">Royalties</TH></tr></THead>
              <TBody>{data.byMonth.map((m) => <TR key={m.month + m.currency}><TD>{m.month}</TD><TD className="text-right tabular">{m.units}</TD><TD className="text-right tabular">{formatMoney(m.royalties, m.currency)}</TD></TR>)}</TBody></Table>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Royalties by design</CardTitle><Button variant="outline" size="sm" disabled={!data.byDesign.length} onClick={() => downloadCsv('royalties-by-design.csv', data.byDesign)}>Export CSV</Button></CardHeader>
        <CardContent className="px-0 pb-2">
          {data.byDesign.length === 0 ? <EmptyState title="Nothing to show" /> : (
            <Table><THead><tr><TH>Design</TH><TH className="text-right">Units</TH><TH className="text-right">Royalties</TH></tr></THead>
              <TBody>{data.byDesign.map((d, i) => <TR key={i}><TD>{d.designId ? <Link className="hover:underline" href={`/designs/${d.designId}`}>{d.title}</Link> : <span className="text-muted-foreground">Unmapped ASINs</span>}</TD><TD className="text-right tabular">{d.units}</TD><TD className="text-right tabular">{formatMoney(d.royalties, d.currency)}</TD></TR>)}</TBody></Table>
          )}
        </CardContent>
      </Card>
      {data.unmappedAsins.length > 0 && (
        <Card className="lg:col-span-2">
          <CardHeader><div><CardTitle>Unmapped ASINs</CardTitle><CardDescription>Create a listing for these ASINs to attribute royalties to designs. Existing royalties are linked automatically.</CardDescription></div><Button asChild size="sm"><Link href="/listings">Go to listings</Link></Button></CardHeader>
          <CardContent className="flex flex-wrap gap-2">{data.unmappedAsins.map((u) => <span key={u.asin + u.marketplace} className="rounded-lg border px-2 py-1 font-mono text-xs">{u.asin} · {u.marketplace} · {u.units} units</span>)}</CardContent>
        </Card>
      )}
    </div>
  );
}

export default function AmazonMerchPage() {
  const imports = useApi<ImportRecord[]>('/amazon-merch/imports', { refreshInterval: (d) => (d?.some((i) => i.status === 'PENDING' || i.status === 'PROCESSING') ? 3000 : 0) });
  const royalties = useList<Royalty & Record<string, unknown>>('/amazon-merch/royalties');
  const payouts = useApi<{ id: string; externalId: string; amount: string; currency: string; periodStart: string; periodEnd: string; status: string; paidAt: string | null }[]>('/amazon-merch/payouts');
  const totals = (royalties.data as unknown as { totals?: { currency: string; royalties: string; unitsSold: number }[] } | undefined)?.totals ?? [];

  return (
    <>
      <PageHeader title="Amazon Merch on Demand" description="Royalties are imported from your Merch reports — there is no supported Merch API, and pages are never scraped." />
      <Tabs defaultValue="royalties">
        <TabsList>
          <TabsTrigger value="royalties">Royalties</TabsTrigger>
          <TabsTrigger value="import">Import</TabsTrigger>
          <TabsTrigger value="history">Import history</TabsTrigger>
          <TabsTrigger value="summary">Trends</TabsTrigger>
          <TabsTrigger value="payouts">Payouts</TabsTrigger>
        </TabsList>
        <TabsContent value="royalties">
          <Card>
            <div className="flex flex-wrap items-center gap-3 border-b p-3">
              <SearchInput value={royalties.q} onChange={royalties.setSearch} placeholder="ASIN or title" />
              {totals.map((t) => <span key={t.currency} className="text-sm">Total <strong className="tabular">{formatMoney(t.royalties, t.currency)}</strong> · {t.unitsSold} units</span>)}
            </div>
            <DataTable
              rows={royalties.data?.items}
              isLoading={royalties.isLoading}
              error={royalties.error}
              rowKey={(r) => r.id}
              pagination={royalties.pagination}
              empty={{ title: 'No royalties yet', description: 'Import a Merch report to get started.' }}
              columns={[
                { header: 'Date', cell: (r) => formatDate(r.transactionDate) },
                { header: 'ASIN', cell: (r) => <span className="font-mono text-xs">{r.asin}</span> },
                { header: 'Marketplace', cell: (r) => r.marketplace },
                { header: 'Design', cell: (r) => r.listing?.design?.title ?? <span className="text-muted-foreground">Unmapped</span> },
                { header: 'Sold', cell: (r) => r.unitsSold, className: 'text-right tabular' },
                { header: 'Returned', cell: (r) => r.unitsReturned, className: 'text-right tabular' },
                { header: 'Royalty', cell: (r) => formatMoney(r.royaltyAmount, r.currency), className: 'text-right tabular' },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="import"><ImportPanel onImported={() => imports.mutate()} /></TabsContent>
        <TabsContent value="history">
          <Card>
            <DataTable
              rows={imports.data}
              isLoading={imports.isLoading}
              error={imports.error}
              rowKey={(i) => i.id}
              empty={{ title: 'No imports yet' }}
              columns={[
                { header: 'File', cell: (i) => <span className="font-medium">{i.fileName}</span> },
                { header: 'Uploaded', cell: (i) => formatDateTime(i.createdAt) },
                { header: 'Status', cell: (i) => <StatusBadge status={i.status} /> },
                { header: 'Rows', cell: (i) => i.rowCount, className: 'text-right tabular' },
                { header: 'Imported', cell: (i) => i.importedCount, className: 'text-right tabular' },
                { header: 'Duplicates', cell: (i) => i.duplicateCount, className: 'text-right tabular' },
                { header: 'Errors', cell: (i) => i.errorCount, className: 'text-right tabular' },
              ]}
            />
          </Card>
        </TabsContent>
        <TabsContent value="summary"><Summary /></TabsContent>
        <TabsContent value="payouts">
          <Card>
            <CardHeader><div><CardTitle>Amazon payouts</CardTitle><CardDescription>Record payouts under Finance. A daily job reconciles paid payouts against imported royalties.</CardDescription></div><Button asChild size="sm" variant="outline"><Link href="/finance?tab=payouts">Record payout</Link></Button></CardHeader>
            <DataTable
              rows={payouts.data}
              isLoading={payouts.isLoading}
              error={payouts.error}
              rowKey={(p) => p.id}
              empty={{ title: 'No payouts recorded' }}
              columns={[
                { header: 'Reference', cell: (p) => p.externalId },
                { header: 'Period', cell: (p) => `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` },
                { header: 'Paid', cell: (p) => formatDate(p.paidAt) },
                { header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
                { header: 'Amount', cell: (p) => formatMoney(p.amount, p.currency), className: 'text-right tabular' },
              ]}
            />
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}
