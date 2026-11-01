import { AlertTriangle, Inbox } from 'lucide-react';
import type { ReactNode } from 'react';
import { ApiError } from '@/lib/api';
import { Skeleton } from './ui/skeleton';

export function EmptyState({ title, description, action, icon }: { title: string; description?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-muted p-3 text-muted-foreground">{icon ?? <Inbox className="size-5" />}</div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, action }: { error: unknown; action?: ReactNode }) {
  const message = error instanceof Error ? error.message : 'Something went wrong';
  const details = error instanceof ApiError && Array.isArray(error.details) ? (error.details as unknown[]) : [];
  return (
    <div role="alert" className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      <div className="rounded-full bg-destructive/10 p-3 text-destructive"><AlertTriangle className="size-5" /></div>
      <p className="text-sm font-medium">{message}</p>
      {details.length > 0 && (
        <ul className="text-xs text-muted-foreground">
          {details.map((d, i) => <li key={i}>{typeof d === 'string' ? d : JSON.stringify(d)}</li>)}
        </ul>
      )}
      {action}
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}
    </div>
  );
}
