import type { ReactNode } from 'react';
import { Card } from './ui/card';
import { Skeleton } from './ui/skeleton';

export function StatCard({ label, value, hint, icon, loading }: { label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; loading?: boolean }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {icon && <span className="text-muted-foreground/80 [&_svg]:size-4">{icon}</span>}
      </div>
      <div className="mt-2 text-xl font-semibold tracking-tight tabular">{loading ? <Skeleton className="h-7 w-24" /> : value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </Card>
  );
}
