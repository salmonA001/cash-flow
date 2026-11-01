'use client';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/lib/api';
import { Label } from './ui/input';

/** The <label> wraps its control, so every field is programmatically labelled. */
export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="space-y-1.5">
      <Label className="block space-y-1.5">
        <span className="block">{label}</span>
        {children}
      </Label>
      {error ? <p className="text-xs text-destructive">{error}</p> : hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Runs a mutation with success/error toasts. Returns true on success. */
export async function mutate(action: () => Promise<unknown>, success: string): Promise<boolean> {
  try {
    await action();
    toast.success(success);
    return true;
  } catch (err) {
    const details = err instanceof ApiError && Array.isArray(err.details) ? (err.details as { message?: string }[]).map((d) => (typeof d === 'string' ? d : d.message)).join('; ') : undefined;
    toast.error(err instanceof Error ? err.message : 'Request failed', { description: details });
    return false;
  }
}

/** react-hook-form option for optional fields: an empty input/select means "not provided". */
export const optional = { setValueAs: (v: unknown) => (v === '' ? undefined : v) };
