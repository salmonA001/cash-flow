'use client';
import { useState, type ReactNode } from 'react';
import { Button } from './ui/button';
import { Dialog, DialogContent } from './ui/dialog';

/** Explicit confirmation for consequential actions (live fulfillment, revocation, …). */
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  destructive,
  onConfirm,
}: {
  trigger: ReactNode;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <span onClick={(e) => { e.stopPropagation(); setOpen(true); }}>{trigger}</span>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={title}>
          <div className="text-sm text-muted-foreground">{description}</div>
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              variant={destructive ? 'destructive' : 'default'}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirm();
                  setOpen(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Working…' : confirmLabel}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
