'use client';
import * as TabsPrimitive from '@radix-ui/react-tabs';
import * as React from 'react';
import { cn } from '@/lib/utils';

export const Tabs = TabsPrimitive.Root;
export const TabsContent = (p: React.ComponentProps<typeof TabsPrimitive.Content>) => <TabsPrimitive.Content {...p} className={cn('mt-4 outline-none', p.className)} />;
export const TabsList = (p: React.ComponentProps<typeof TabsPrimitive.List>) => (
  <TabsPrimitive.List {...p} className={cn('inline-flex flex-wrap gap-1 rounded-xl bg-muted p-1', p.className)} />
);
export const TabsTrigger = (p: React.ComponentProps<typeof TabsPrimitive.Trigger>) => (
  <TabsPrimitive.Trigger
    {...p}
    className={cn('rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:bg-card-solid data-[state=active]:text-foreground data-[state=active]:shadow-sm', p.className)}
  />
);
