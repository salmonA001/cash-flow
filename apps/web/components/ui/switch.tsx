'use client';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import * as React from 'react';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn('inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input transition-colors disabled:opacity-40 data-[state=checked]:bg-primary', className)}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-4 translate-x-0.5 rounded-full bg-white shadow transition-transform data-[state=checked]:translate-x-4.5" />
    </SwitchPrimitive.Root>
  );
}
