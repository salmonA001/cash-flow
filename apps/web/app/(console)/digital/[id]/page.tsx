'use client';
import { ArrowLeft, Upload } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { mutate } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useApi } from '@/hooks/use-api';
import { api, upload } from '@/lib/api';
import { formatBytes, formatDate, formatDateTime, humanize } from '@/lib/format';

interface Detail {
  id: string;
  maxDownloads: number;
  accessDays: number;
  product: { title: string; description: string | null };
  assets: { id: string; version: number; fileName: string; sizeBytes: number; checksumSha256: string; isCurrent: boolean; createdAt: string }[];
  entitlements: {
    id: string; email: string; status: string; downloadCount: number; maxDownloads: number; expiresAt: string; emailSentAt: string | null; revokedReason: string | null; createdAt: string;
    events: { id: string; outcome: string; createdAt: string }[];
  }[];
}

export default function DigitalDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, mutate: reload } = useApi<Detail>(`/digital-products/${id}`);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  if (error) return <ErrorState error={error} />;
  if (!data) return <LoadingRows rows={6} />;

  return (
    <>
      <Button asChild variant="link" size="sm" className="mb-2"><Link href="/digital"><ArrowLeft /> Digital Delivery</Link></Button>
      <PageHeader title={data.product.title} description={`${data.maxDownloads} downloads per purchase · links expire after ${data.accessDays} days`} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><div><CardTitle>File versions</CardTitle><CardDescription>Only the current version is served. Max 500 MB.</CardDescription></div></CardHeader>
          <CardContent className="space-y-4">
            <form
              className="flex gap-2"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!file) return;
                setBusy(true);
                const form = new FormData();
                form.append('file', file);
                const ok = await mutate(() => upload(`/digital-products/${id}/files`, form), 'New version uploaded');
                setBusy(false);
                if (ok) {
                  (e.target as HTMLFormElement).reset();
                  setFile(null);
                  reload();
                }
              }}
            >
              <Input type="file" aria-label="Product file" accept=".zip,.pdf,.png,.jpg,.jpeg,.svg" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <Button type="submit" size="icon" aria-label="Upload" disabled={!file || busy}><Upload /></Button>
            </form>
            {data.assets.length === 0 ? <EmptyState title="No file uploaded" description="Buyers cannot download until a file exists." /> : (
              <ul className="space-y-2 text-sm">
                {data.assets.map((a) => (
                  <li key={a.id} className="rounded-xl border p-2.5">
                    <div className="flex items-center justify-between"><span className="font-medium">v{a.version}</span>{a.isCurrent && <StatusBadge status="ACTIVE" />}</div>
                    <p className="truncate">{a.fileName}</p>
                    <p className="text-xs text-muted-foreground">{formatBytes(a.sizeBytes)} · {formatDate(a.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader><div><CardTitle>Entitlements</CardTitle><CardDescription>Granted automatically for paid orders; links are emailed once and stored only as hashes.</CardDescription></div></CardHeader>
          <CardContent className="px-0 pb-2">
            {data.entitlements.length === 0 ? <EmptyState title="No entitlements yet" /> : (
              <Table>
                <THead><tr><TH>Customer</TH><TH>Status</TH><TH className="text-right">Downloads</TH><TH>Expires</TH><TH>Email</TH><TH>Recent activity</TH><TH /></tr></THead>
                <TBody>
                  {data.entitlements.map((e) => (
                    <TR key={e.id}>
                      <TD>{e.email}</TD>
                      <TD><StatusBadge status={e.status} />{e.revokedReason && <p className="text-xs text-muted-foreground">{e.revokedReason}</p>}</TD>
                      <TD className="text-right tabular">{e.downloadCount}/{e.maxDownloads}</TD>
                      <TD>{formatDate(e.expiresAt)}</TD>
                      <TD>{e.emailSentAt ? formatDateTime(e.emailSentAt) : <StatusBadge status="PENDING" />}</TD>
                      <TD className="text-xs text-muted-foreground">{e.events.map((ev) => `${humanize(ev.outcome)} ${formatDate(ev.createdAt)}`).join(' · ') || '—'}</TD>
                      <TD>
                        {e.status === 'ACTIVE' && (
                          <ConfirmDialog
                            trigger={<Button size="sm" variant="ghost">Revoke</Button>}
                            title="Revoke this download?"
                            description={`${e.email} will no longer be able to download this product.`}
                            confirmLabel="Revoke access"
                            destructive
                            onConfirm={() => mutate(() => api(`/downloads/${e.id}/revoke`, { method: 'POST', json: { reason: 'Revoked by administrator' } }), 'Access revoked').then(() => reload())}
                          />
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
