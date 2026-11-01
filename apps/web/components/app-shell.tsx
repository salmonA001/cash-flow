'use client';
import {
  BarChart3, Bell, Boxes, Download, Factory, FolderKanban, LayoutDashboard, LogOut, Menu, Moon, Palette,
  Receipt, Settings, ShoppingBag, Store, Sun, Tags, Users, Workflow, X,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { useApi } from '@/hooks/use-api';
import { useSession } from '@/hooks/use-session';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Button } from './ui/button';

const NAV: { group: string; items: { href: string; label: string; icon: ReactNode }[] }[] = [
  { group: 'Overview', items: [{ href: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard /> }] },
  {
    group: 'Create',
    items: [
      { href: '/designs', label: 'Design Studio', icon: <Palette /> },
      { href: '/collections', label: 'Collections', icon: <FolderKanban /> },
      { href: '/products', label: 'Products', icon: <Boxes /> },
      { href: '/listings', label: 'Listings', icon: <Tags /> },
    ],
  },
  {
    group: 'Sell',
    items: [
      { href: '/orders', label: 'Orders', icon: <ShoppingBag /> },
      { href: '/fulfillment', label: 'POD Fulfillment', icon: <Factory /> },
      { href: '/digital', label: 'Digital Delivery', icon: <Download /> },
      { href: '/customers', label: 'Customers', icon: <Users /> },
      { href: '/amazon-merch', label: 'Amazon Merch', icon: <Store /> },
    ],
  },
  {
    group: 'Money',
    items: [
      { href: '/finance', label: 'Finance', icon: <Receipt /> },
      { href: '/analytics', label: 'Analytics', icon: <BarChart3 /> },
    ],
  },
  {
    group: 'System',
    items: [
      { href: '/automation', label: 'Automation', icon: <Workflow /> },
      { href: '/settings', label: 'Settings', icon: <Settings /> },
    ],
  },
];

function Nav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="space-y-5">
      {NAV.map((section) => (
        <div key={section.group}>
          <p className="mb-1.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">{section.group}</p>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition-colors [&_svg]:size-4',
                      active ? 'bg-accent font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                  >
                    {item.icon}
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-3">
      <span className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">CF</span>
      <span className="text-sm font-semibold tracking-tight">Cash Flow Engine</span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { user } = useSession();
  const router = useRouter();
  const { data: notifications } = useApi<{ id: string; readAt: string | null }[]>('/notifications', { refreshInterval: 60_000 });
  const { data: org } = useApi<{ name: string; demoMode: boolean }>('/organization');
  const unread = notifications?.filter((n) => !n.readAt).length ?? 0;

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    router.push('/login');
  }

  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col border-r bg-card/60 py-5 backdrop-blur-xl lg:flex">
        <Brand />
        <div className="mt-6 flex-1 overflow-y-auto px-3"><Nav /></div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col bg-card-solid py-5 shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <Button variant="ghost" size="icon" aria-label="Close menu" onClick={() => setMobileOpen(false)}><X /></Button>
            </div>
            <div className="mt-6 flex-1 overflow-y-auto px-3"><Nav onNavigate={() => setMobileOpen(false)} /></div>
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-background/70 px-4 backdrop-blur-xl sm:px-6">
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open menu" onClick={() => setMobileOpen(true)}><Menu /></Button>
        <span className="truncate text-sm text-muted-foreground">{org?.name}</span>
        {org?.demoMode && (
          <Link href="/settings" className="whitespace-nowrap rounded-md bg-warning/12 px-2 py-0.5 text-xs font-medium text-warning" title="Live external actions are disabled">Demo mode</Link>
        )}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" aria-label="Toggle theme" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>
            <Sun className="hidden dark:block" /><Moon className="dark:hidden" />
          </Button>
          <Button variant="ghost" size="icon" asChild aria-label={`Notifications (${unread} unread)`}>
            <Link href="/settings?tab=inbox" className="relative">
              <Bell />
              {unread > 0 && <span className="absolute right-1.5 top-1.5 size-2 rounded-full bg-primary" />}
            </Link>
          </Button>
          <div className="ml-2 hidden text-right sm:block">
            <p className="text-xs font-medium leading-tight">{user?.name}</p>
            <p className="text-[11px] leading-tight text-muted-foreground">{user?.roleName}</p>
          </div>
          <Button variant="ghost" size="icon" aria-label="Log out" onClick={logout}><LogOut /></Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:py-8">{children}</main>
    </div>
  );
}
