'use client';
import { Check, Copy } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { DataTable } from '@/components/data-table';
import { Field, mutate } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { EmptyState, LoadingRows } from '@/components/states';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useApi } from '@/hooks/use-api';
import { useList } from '@/hooks/use-list';
import { useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/format';

interface Org { id: string; name: string; baseCurrency: string; demoMode: boolean; fulfillmentRequiresApproval: boolean }
interface Integration { provider: string; credential: { accountRef: string; status: string; connectedAt: string; lastError: string | null; scopes: string | null } | null; events: Record<string, number>; webhookUrl?: string; apiVersion?: string; note?: string }
interface Role { id: string; name: string; description: string | null; permissions: { permission: { key: string } }[] }
interface User { id: string; email: string; name: string; isActive: boolean; lastLoginAt: string | null; role: { id: string; name: string } }

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-xs" />
      <Button type="button" variant="outline" size="icon" aria-label="Copy" onClick={() => { navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>{copied ? <Check /> : <Copy />}</Button>
    </div>
  );
}

function OrganizationTab() {
  const { data: org, mutate: reload } = useApi<Org>('/organization');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState('');
  useEffect(() => { if (org) { setName(org.name); setCurrency(org.baseCurrency); } }, [org]);
  if (!org) return <LoadingRows />;
  const patch = (json: Partial<Org>, msg: string) => mutate(() => api('/organization', { method: 'PATCH', json }), msg).then(() => reload());
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><CardTitle>Organization profile</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); patch({ name, baseCurrency: currency.toUpperCase() }, 'Organization saved'); }}>
            <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Base currency" hint="All reports convert to this currency using stored exchange rates."><Input maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value)} /></Field>
            <Button type="submit">Save</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><div><CardTitle>Safety controls</CardTitle><CardDescription>Applies to every live external action.</CardDescription></div></CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-sm font-medium">Demo mode</p><p className="text-xs text-muted-foreground">Blocks live Printful submissions. Turn off only when integrations are verified.</p></div>
            <ConfirmDialog
              trigger={<Switch aria-label="Demo mode" checked={org.demoMode} />}
              title={org.demoMode ? 'Go live?' : 'Enable demo mode?'}
              description={org.demoMode ? 'Approved fulfillments will create real, billable Printful orders.' : 'Live fulfillment submissions will be blocked.'}
              confirmLabel={org.demoMode ? 'Go live' : 'Enable demo mode'}
              destructive={org.demoMode}
              onConfirm={() => patch({ demoMode: !org.demoMode }, org.demoMode ? 'Live mode enabled' : 'Demo mode enabled')}
            />
          </div>
          <div className="flex items-start justify-between gap-4">
            <div><p className="text-sm font-medium">Require fulfillment approval</p><p className="text-xs text-muted-foreground">New tasks wait for a human before submission. Recommended during rollout.</p></div>
            <Switch aria-label="Require fulfillment approval" checked={org.fulfillmentRequiresApproval} onCheckedChange={(v) => patch({ fulfillmentRequiresApproval: v }, 'Saved')} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function IntegrationsTab() {
  const { data, mutate: reload } = useApi<Integration[]>('/integrations');
  const { can } = useSession();
  const [shop, setShop] = useState('');
  const [token, setToken] = useState('');
  const [storeId, setStoreId] = useState('');
  if (!data) return <LoadingRows />;
  const by = (p: string) => data.find((i) => i.provider === p)!;
  const shopify = by('SHOPIFY');
  const printful = by('PRINTFUL');
  const header = (i: Integration, title: string) => (
    <CardHeader>
      <div><CardTitle>{title}</CardTitle><CardDescription>{i.credential ? `${i.credential.accountRef} · since ${formatDateTime(i.credential.connectedAt)}` : 'Not connected'}</CardDescription></div>
      <StatusBadge status={i.credential?.status ?? 'DISCONNECTED'} />
    </CardHeader>
  );
  const disconnect = (provider: string) => (
    <ConfirmDialog trigger={<Button variant="ghost" size="sm">Disconnect</Button>} title={`Disconnect ${humanize(provider)}?`} description="Stored credentials are erased. Webhooks will be ignored until you reconnect." confirmLabel="Disconnect" destructive
      onConfirm={() => mutate(() => api(`/integrations/${provider}/disconnect`, { method: 'POST' }), 'Disconnected').then(() => reload())} />
  );
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        {header(shopify, 'Shopify')}
        <CardContent className="space-y-4">
          {shopify.credential?.lastError && <p className="text-xs text-destructive">{shopify.credential.lastError}</p>}
          {can('integrations:write') && (
            <form className="flex gap-2" onSubmit={async (e) => {
              e.preventDefault();
              await mutate(async () => {
                const { installUrl } = await api<{ installUrl: string }>('/integrations/shopify/connect', { method: 'POST', json: { shop } });
                window.location.href = installUrl;
              }, 'Redirecting to Shopify…');
            }}>
              <Input placeholder="your-store.myshopify.com" value={shop} onChange={(e) => setShop(e.target.value.trim().toLowerCase())} aria-label="Shop domain" />
              <Button type="submit" disabled={!shop}>{shopify.credential ? 'Reconnect' : 'Connect'}</Button>
            </form>
          )}
          <Field label="Webhook endpoint (registered automatically)"><CopyField value={shopify.webhookUrl!} /></Field>
          <p className="text-xs text-muted-foreground">Admin API version {shopify.apiVersion} · events: {Object.entries(shopify.events).map(([k, v]) => `${v} ${k.toLowerCase()}`).join(', ') || 'none yet'}</p>
          {shopify.credential && can('integrations:write') && disconnect('SHOPIFY')}
        </CardContent>
      </Card>
      <Card>
        {header(printful, 'Printful')}
        <CardContent className="space-y-4">
          {can('integrations:write') && (
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault();
              if (await mutate(() => api('/integrations/printful/connect', { method: 'POST', json: { apiToken: token, storeId } }), 'Printful connected')) {
                setToken('');
                reload();
              }
            }}>
              <Field label="API token" hint="Validated with a read-only call, then stored encrypted. Never shown again."><Input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></Field>
              <Field label="Store ID"><Input inputMode="numeric" value={storeId} onChange={(e) => setStoreId(e.target.value)} /></Field>
              <Button type="submit" disabled={!token || !storeId}>{printful.credential ? 'Update credentials' : 'Connect'}</Button>
            </form>
          )}
          <Field label="Webhook URL to configure in Printful"><CopyField value={printful.webhookUrl!} /></Field>
          {printful.credential && can('integrations:write') && disconnect('PRINTFUL')}
        </CardContent>
      </Card>
      <Card className="lg:col-span-2">
        <CardHeader><div><CardTitle>Amazon Merch on Demand</CardTitle><CardDescription>{by('AMAZON_MERCH').note}</CardDescription></div></CardHeader>
      </Card>
    </div>
  );
}

function UsersTab() {
  const { data: users, mutate: reload, error, isLoading } = useApi<User[]>('/users');
  const { data: roles } = useApi<Role[]>('/roles');
  const [form, setForm] = useState({ email: '', name: '', password: '', roleId: '' });
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Users</CardTitle></CardHeader>
        <DataTable rows={users} error={error} isLoading={isLoading} rowKey={(u) => u.id} empty={{ title: 'No users' }}
          columns={[
            { header: 'User', cell: (u) => <div><p className="font-medium">{u.name}</p><p className="text-xs text-muted-foreground">{u.email}</p></div> },
            { header: 'Role', cell: (u) => (
              <Select aria-label={`Role for ${u.email}`} className="h-8 w-32 text-xs" value={u.role.id} onChange={(e) => mutate(() => api(`/users/${u.id}`, { method: 'PATCH', json: { roleId: e.target.value } }), 'Role updated').then(() => reload())}>
                {roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </Select>
            ) },
            { header: 'Last login', cell: (u) => formatDateTime(u.lastLoginAt) },
            { header: 'Active', cell: (u) => <Switch aria-label={`Active ${u.email}`} checked={u.isActive} onCheckedChange={(isActive) => mutate(() => api(`/users/${u.id}`, { method: 'PATCH', json: { isActive } }), isActive ? 'User activated' : 'User deactivated — sessions revoked').then(() => reload())} /> },
          ]} />
      </Card>
      <Card>
        <CardHeader><CardTitle>Add user</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={async (e) => {
            e.preventDefault();
            if (await mutate(() => api('/users', { method: 'POST', json: form }), 'User added')) {
              setForm({ email: '', name: '', password: '', roleId: '' });
              reload();
            }
          }}>
            <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
            <Field label="Initial password" hint="At least 12 characters"><Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
            <Field label="Role"><Select value={form.roleId} onChange={(e) => setForm({ ...form, roleId: e.target.value })}><option value="">Select…</option>{roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
            <Button type="submit" disabled={!form.roleId}>Add user</Button>
          </form>
        </CardContent>
      </Card>
      <Card className="lg:col-span-3">
        <CardHeader><div><CardTitle>Roles & permissions</CardTitle><CardDescription>Default roles. Approval permissions gate live and legal-judgment actions.</CardDescription></div></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {roles?.map((r) => (
            <div key={r.id} className="rounded-xl border p-3">
              <p className="font-medium">{r.name}</p>
              <p className="mb-2 text-xs text-muted-foreground">{r.description}</p>
              <div className="flex flex-wrap gap-1">{r.permissions.map((p) => <span key={p.permission.key} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]">{p.permission.key}</span>)}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function InboxTab() {
  const notes = useApi<{ id: string; severity: string; title: string; body: string; readAt: string | null; createdAt: string }[]>('/notifications');
  const tasks = useApi<{ id: string; kind: string; summary: string; subjectType: string; createdAt: string; details: unknown }[]>('/review-tasks');
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader><div><CardTitle>Review tasks</CardTitle><CardDescription>Items the system refused to guess about.</CardDescription></div></CardHeader>
        <CardContent className="pt-2">
          {!tasks.data ? <LoadingRows /> : tasks.data.length === 0 ? <EmptyState title="Nothing to review" /> : (
            <ul className="divide-y">{tasks.data.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 text-sm"><p className="font-medium">{t.summary}</p><p className="text-xs text-muted-foreground">{humanize(t.kind)} · {formatDateTime(t.createdAt)}</p>
                  {t.details ? <pre className="mt-1 max-h-24 overflow-auto rounded bg-muted p-2 text-[11px]">{JSON.stringify(t.details, null, 2)}</pre> : null}
                </div>
                <Button size="sm" variant="outline" onClick={() => mutate(() => api(`/review-tasks/${t.id}/resolve`, { method: 'POST' }), 'Resolved').then(() => tasks.mutate())}>Resolve</Button>
              </li>
            ))}</ul>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Notifications</CardTitle></CardHeader>
        <CardContent className="pt-2">
          {!notes.data ? <LoadingRows /> : notes.data.length === 0 ? <EmptyState title="No notifications" /> : (
            <ul className="divide-y">{notes.data.map((n) => (
              <li key={n.id} className={`flex items-start justify-between gap-3 py-3 text-sm ${n.readAt ? 'opacity-60' : ''}`}>
                <div><p className="font-medium"><StatusBadge status={n.severity === 'CRITICAL' ? 'FAILED' : n.severity === 'WARNING' ? 'PENDING' : 'OPEN'} /> {n.title}</p><p className="text-muted-foreground">{n.body}</p><p className="text-xs text-muted-foreground">{formatDateTime(n.createdAt)}</p></div>
                {!n.readAt && <Button size="sm" variant="ghost" onClick={() => api(`/notifications/${n.id}/read`, { method: 'POST' }).then(() => notes.mutate())}>Mark read</Button>}
              </li>
            ))}</ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function AuditTab() {
  const list = useList<{ id: string; action: string; entityType: string; entityId: string | null; actorUserId: string | null; createdAt: string; metadata: unknown }>('/audit-logs');
  return (
    <Card>
      <DataTable rows={list.data?.items} isLoading={list.isLoading} error={list.error} rowKey={(a) => a.id} pagination={list.pagination} empty={{ title: 'No audit entries' }}
        columns={[
          { header: 'When', cell: (a) => formatDateTime(a.createdAt) },
          { header: 'Action', cell: (a) => <span className="font-mono text-xs">{a.action}</span> },
          { header: 'Entity', cell: (a) => `${a.entityType}${a.entityId ? ` · ${a.entityId.slice(-8)}` : ''}` },
          { header: 'Actor', cell: (a) => (a.actorUserId ? a.actorUserId.slice(-8) : 'system') },
          { header: 'Details', cell: (a) => <span className="line-clamp-1 max-w-md font-mono text-[11px] text-muted-foreground">{a.metadata ? JSON.stringify(a.metadata) : ''}</span> },
        ]} />
    </Card>
  );
}

export default function SettingsPage() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = params.get('tab') ?? 'organization';
  const { can } = useSession();
  useEffect(() => {
    if (params.get('integration') === 'shopify-connected') toast.success('Shopify connected');
  }, [params]);
  return (
    <>
      <PageHeader title="Settings" description="Organization, integrations, people and security." />
      <Tabs value={tab} onValueChange={(t) => router.replace(`/settings?tab=${t}`)}>
        <TabsList>
          <TabsTrigger value="organization">Organization</TabsTrigger>
          <TabsTrigger value="integrations">Integrations</TabsTrigger>
          {can('users:write') && <TabsTrigger value="users">Users & roles</TabsTrigger>}
          <TabsTrigger value="inbox">Inbox</TabsTrigger>
          {can('audit:read') && <TabsTrigger value="audit">Audit log</TabsTrigger>}
        </TabsList>
        <TabsContent value="organization"><OrganizationTab /></TabsContent>
        <TabsContent value="integrations"><IntegrationsTab /></TabsContent>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="inbox"><InboxTab /></TabsContent>
        <TabsContent value="audit"><AuditTab /></TabsContent>
      </Tabs>
    </>
  );
}
