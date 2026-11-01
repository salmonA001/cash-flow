'use client';
import { Lock, Plus } from 'lucide-react';
import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { Field, mutate } from '@/components/form';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useApi } from '@/hooks/use-api';
import { useList } from '@/hooks/use-list';
import { useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { formatDateTime, humanize } from '@/lib/format';
import type { AutomationRun } from '@/types/api';

interface Rule { id: string; key: string; name: string; trigger: string; action: string; level: string; enabled: boolean; builtIn: boolean; toggleable: boolean }
interface RulesResponse { rules: Rule[]; triggers: string[]; customActions: string[] }

const LEVEL_TONE = { AUTOMATIC: 'neutral', APPROVAL_REQUIRED: 'warning', HUMAN_JUDGMENT: 'danger' } as const;

function CustomRuleDialog({ triggers, actions, onSaved }: { triggers: string[]; actions: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [trigger, setTrigger] = useState(triggers[0] ?? '');
  const [action, setAction] = useState(actions[0] ?? '');
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> Custom rule</Button></DialogTrigger>
      <DialogContent title="New custom rule" description="Custom rules run after a built-in trigger and can only notify or open a review task.">
        <form className="space-y-4" onSubmit={async (e) => {
          e.preventDefault();
          const key = `custom.${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
          if (await mutate(() => api('/automation/rules', { method: 'POST', json: { key, name, trigger, action, level: 'AUTOMATIC' } }), 'Rule created')) {
            setOpen(false);
            setName('');
            onSaved();
          }
        }}>
          <Field label="Name"><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="Notify me about refunds" /></Field>
          <Field label="When (trigger)"><Select value={trigger} onChange={(e) => setTrigger(e.target.value)}>{triggers.map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</Select></Field>
          <Field label="Then (action)"><Select value={action} onChange={(e) => setAction(e.target.value)}>{actions.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}</Select></Field>
          <div className="flex justify-end"><Button type="submit" disabled={!name.trim()}>Create rule</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function AutomationPage() {
  const rules = useApi<RulesResponse>('/automation/rules');
  const runs = useList<AutomationRun>('/automation/runs', {}, 20);
  const { can } = useSession();
  const editable = can('automation:write');

  return (
    <>
      <PageHeader
        title="Automation"
        description="Level 1 runs automatically · Level 2 waits for approval · Level 3 always needs human judgment."
        actions={rules.data && editable && <CustomRuleDialog triggers={rules.data.triggers} actions={rules.data.customActions} onSaved={() => rules.mutate()} />}
      />
      <div className="space-y-4">
        <Card>
          <CardHeader><div><CardTitle>Rules</CardTitle><CardDescription>Core workflow steps (locked) cannot be disabled.</CardDescription></div></CardHeader>
          <DataTable
            rows={rules.data?.rules}
            isLoading={rules.isLoading}
            error={rules.error}
            rowKey={(r) => r.id}
            empty={{ title: 'No rules configured' }}
            columns={[
              { header: 'Rule', cell: (r) => <div><p className="font-medium">{r.name}</p><p className="font-mono text-[11px] text-muted-foreground">{r.key}</p></div> },
              { header: 'Trigger', cell: (r) => humanize(r.trigger) },
              { header: 'Action', cell: (r) => humanize(r.action) },
              { header: 'Level', cell: (r) => <Badge tone={LEVEL_TONE[r.level as keyof typeof LEVEL_TONE]}>{humanize(r.level)}</Badge> },
              {
                header: 'Enabled',
                cell: (r) =>
                  r.toggleable ? (
                    <Switch aria-label={`Enable ${r.name}`} checked={r.enabled} disabled={!editable}
                      onCheckedChange={(enabled) => mutate(() => api(`/automation/rules/${r.id}`, { method: 'PATCH', json: { enabled } }), enabled ? 'Rule enabled' : 'Rule disabled').then(() => rules.mutate())} />
                  ) : <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="size-3" /> Core</span>,
              },
            ]}
          />
        </Card>
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <CardTitle className="px-2">Execution history</CardTitle>
            <Select aria-label="Run status" className="w-44" value={runs.filters.status ?? ''} onChange={(e) => runs.setFilter('status', e.target.value)}>
              <option value="">All statuses</option>
              {['PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED'].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}
            </Select>
          </div>
          <DataTable
            rows={runs.data?.items}
            isLoading={runs.isLoading}
            error={runs.error}
            rowKey={(r) => r.id}
            pagination={runs.pagination}
            empty={{ title: 'No runs yet' }}
            columns={[
              { header: 'When', cell: (r) => formatDateTime(r.createdAt) },
              { header: 'Action', cell: (r) => <div><p>{humanize(r.action)}</p><p className="text-xs text-muted-foreground">{humanize(r.trigger)}</p></div> },
              { header: 'Subject', cell: (r) => (r.subjectType ? <span className="text-xs">{r.subjectType} <span className="font-mono text-muted-foreground">{r.subjectId?.slice(-8)}</span></span> : '—') },
              { header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
              { header: 'Error', cell: (r) => <span className="line-clamp-2 max-w-xs text-xs text-destructive" title={r.error ?? undefined}>{r.error}</span> },
              {
                header: '',
                cell: (r) => r.status === 'FAILED' && editable && r.action !== 'printful.create_order' && (
                  <Button size="sm" variant="outline" onClick={() => mutate(() => api(`/automation/runs/${r.id}/retry`, { method: 'POST' }), 'Retry queued').then(() => runs.mutate())}>Retry</Button>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
