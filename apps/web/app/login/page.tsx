'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { loginSchema } from '@cfe/validation';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Field } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, refreshSession } from '@/lib/api';

type LoginInput = z.input<typeof loginSchema>;

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });
  const destination = next?.startsWith('/') ? next : '/dashboard';

  // A still-valid refresh session skips the form.
  useEffect(() => {
    refreshSession().then((ok) => ok && router.replace(destination));
  }, [router, destination]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/auth/login', { method: 'POST', json: values });
      router.replace(destination);
    } catch (err) {
      setError((err as Error).message);
    }
  });

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <Field label="Email" error={formState.errors.email?.message}>
        <Input type="email" autoComplete="username" autoFocus {...register('email')} aria-invalid={!!formState.errors.email} />
      </Field>
      <Field label="Password" error={formState.errors.password?.message}>
        <Input type="password" autoComplete="current-password" {...register('password')} aria-invalid={!!formState.errors.password} />
      </Field>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" className="w-full" disabled={formState.isSubmitting}>{formState.isSubmitting ? 'Signing in…' : 'Sign in'}</Button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <Card className="w-full max-w-sm p-8">
        <div className="mb-6 flex items-center gap-2">
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-sm font-bold text-primary-foreground">CF</span>
          <div>
            <h1 className="text-base font-semibold">Cash Flow Engine</h1>
            <p className="text-xs text-muted-foreground">Sign in to your workspace</p>
          </div>
        </div>
        <Suspense>
          <LoginForm />
        </Suspense>
      </Card>
    </div>
  );
}
