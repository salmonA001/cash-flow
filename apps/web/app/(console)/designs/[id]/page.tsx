'use client';
import { ArrowLeft, FileImage, Upload } from 'lucide-react';
import Link from 'next/link';
import { use, useState } from 'react';
import { mutate } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { EmptyState, ErrorState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { useApi } from '@/hooks/use-api';
import { useSession } from '@/hooks/use-session';
import { api, upload } from '@/lib/api';
import { formatBytes, formatDateTime, humanize } from '@/lib/format';
import type { DesignAsset, DesignDetail } from '@/types/api';

function AssetPreview({ asset }: { asset: DesignAsset }) {
  const isImage = asset.contentType === 'image/png' || asset.contentType === 'image/jpeg';
  const { data } = useApi<{ url: string }>(isImage ? `/assets/${asset.id}/url` : null);
  return (
    <div className="flex items-center gap-3 rounded-xl border p-2">
      <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-muted">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {data?.url ? <img src={data.url} alt={asset.fileName} className="size-full object-cover" /> : <FileImage className="size-5 text-muted-foreground" />}
      </div>
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium">{asset.fileName}</p>
        <p className="text-xs text-muted-foreground">{humanize(asset.kind)} · {formatBytes(asset.sizeBytes)}</p>
        <p className="truncate font-mono text-[10px] text-muted-foreground" title={asset.checksumSha256}>sha256 {asset.checksumSha256.slice(0, 16)}…</p>
      </div>
    </div>
  );
}

function UploadForm({ designId, onUploaded }: { designId: string; onUploaded: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState('ORIGINAL');
  const [newVersion, setNewVersion] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file) return;
        setBusy(true);
        const form = new FormData();
        form.append('file', file);
        form.append('kind', kind);
        form.append('newVersion', String(newVersion));
        const ok = await mutate(() => upload(`/designs/${designId}/assets`, form), 'Artwork uploaded');
        setBusy(false);
        if (ok) {
          setFile(null);
          (e.target as HTMLFormElement).reset();
          onUploaded();
        }
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="file">File (PNG, JPG, SVG or PDF · max 100 MB)</Label>
        <Input id="file" type="file" accept=".png,.jpg,.jpeg,.svg,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="kind">Kind</Label>
        <Select id="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {['ORIGINAL', 'PRINT_FILE', 'MOCKUP', 'PREVIEW'].map((k) => <option key={k} value={k}>{humanize(k)}</option>)}
        </Select>
      </div>
      <label className="flex h-9 items-center gap-2 text-sm"><input type="checkbox" checked={newVersion} onChange={(e) => setNewVersion(e.target.checked)} /> New version</label>
      <Button type="submit" disabled={!file || busy}><Upload /> {busy ? 'Uploading…' : 'Upload'}</Button>
    </form>
  );
}

export default function DesignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: design, error, mutate: reload } = useApi<DesignDetail>(`/designs/${id}`);
  const { can } = useSession();

  if (error) return <ErrorState error={error} />;
  if (!design) return <LoadingRows rows={8} />;

  const setStatus = (status: string) => mutate(() => api(`/designs/${id}`, { method: 'PATCH', json: { status } }), `Design marked ${humanize(status).toLowerCase()}`).then(() => reload());

  return (
    <>
      <Button asChild variant="link" size="sm" className="mb-2"><Link href="/designs"><ArrowLeft /> Designs</Link></Button>
      <PageHeader
        title={design.title}
        description={design.description ?? undefined}
        actions={
          <>
            <StatusBadge status={design.status} />
            {design.status === 'DRAFT' && <Button variant="outline" onClick={() => setStatus('IN_REVIEW')}>Submit for review</Button>}
            {design.status !== 'APPROVED' && can('designs:approve') && (
              <Button onClick={() => setStatus('APPROVED')} title="Confirms you hold the rights to this artwork">Approve</Button>
            )}
            {design.status !== 'ARCHIVED' && <Button variant="ghost" onClick={() => setStatus('ARCHIVED')}>Archive</Button>}
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><div><CardTitle>Upload artwork</CardTitle><CardDescription>Files are validated, checksummed and stored privately.</CardDescription></div></CardHeader>
            <CardContent><UploadForm designId={id} onUploaded={() => reload()} /></CardContent>
          </Card>
          {design.versions.map((v) => (
            <Card key={v.id}>
              <CardHeader><div><CardTitle>Version {v.versionNumber}</CardTitle><CardDescription>{v.notes ?? 'No notes'} · {formatDateTime(v.createdAt)}</CardDescription></div></CardHeader>
              <CardContent className="grid gap-2 sm:grid-cols-2">
                {v.assets.length === 0 ? <p className="text-sm text-muted-foreground">No files in this version.</p> : v.assets.map((a) => <AssetPreview key={a.id} asset={a} />)}
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Details</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div><p className="text-xs text-muted-foreground">Category</p><p>{design.category ?? '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Tags</p><div className="mt-1 flex flex-wrap gap-1">{design.tags.length ? design.tags.map((t) => <Badge key={t}>{t}</Badge>) : '—'}</div></div>
              <div><p className="text-xs text-muted-foreground">Collections</p><p>{design.collections.map((c) => c.collection.name).join(', ') || '—'}</p></div>
              <div><p className="text-xs text-muted-foreground">Approved</p><p>{formatDateTime(design.approvedAt)}</p></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Products</CardTitle></CardHeader>
            <CardContent className="pt-2">
              {design.products.length === 0 ? <EmptyState title="Not used by any product" /> : (
                <ul className="space-y-1.5 text-sm">{design.products.map((p) => <li key={p.id} className="flex justify-between"><Link className="hover:underline" href={`/products/${p.id}`}>{p.title}</Link><StatusBadge status={p.status} /></li>)}</ul>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Listings</CardTitle></CardHeader>
            <CardContent className="pt-2">
              {design.listings.length === 0 ? <EmptyState title="No listings" description={design.status === 'APPROVED' ? 'Create one under Listings.' : 'Approve the design to list it.'} /> : (
                <ul className="space-y-1.5 text-sm">{design.listings.map((l) => <li key={l.id} className="flex justify-between gap-2"><span className="truncate">{l.marketplace} · {l.externalId}</span><StatusBadge status={l.status} /></li>)}</ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
