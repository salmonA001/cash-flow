'use client';
import { Input } from './ui/input';

export function DateRange({ from, to, onChange }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Input type="date" aria-label="From" className="w-40" value={from} onChange={(e) => onChange({ from: e.target.value, to })} />
      <span className="text-muted-foreground">–</span>
      <Input type="date" aria-label="To" className="w-40" value={to} onChange={(e) => onChange({ from, to: e.target.value })} />
    </div>
  );
}

export function defaultRange() {
  const to = new Date();
  const from = new Date(Date.UTC(to.getUTCFullYear() - 1, to.getUTCMonth() + 1, 1));
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}
