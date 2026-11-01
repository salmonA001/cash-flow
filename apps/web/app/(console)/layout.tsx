import { Suspense, type ReactNode } from 'react';
import { AppShell } from '@/components/app-shell';
import { LoadingRows } from '@/components/states';

export default function ConsoleLayout({ children }: { children: ReactNode }) {
  return (
    <AppShell>
      <Suspense fallback={<LoadingRows rows={6} />}>{children}</Suspense>
    </AppShell>
  );
}
