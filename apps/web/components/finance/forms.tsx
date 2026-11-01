'use client';
import { zodResolver } from '@hookform/resolvers/zod';
import { exchangeRateCreateSchema, expenseCreateSchema, payoutCreateSchema } from '@cfe/validation';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { Field, mutate, optional } from '@/components/form';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Input, Select } from '@/components/ui/input';
import { api } from '@/lib/api';

const today = () => new Date().toISOString().slice(0, 10);

export function ExpenseDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<z.input<typeof expenseCreateSchema>>({ resolver: zodResolver(expenseCreateSchema), defaultValues: { currency: 'USD', incurredOn: today(), category: 'OPERATING' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    if (await mutate(() => api('/finance/expenses', { method: 'POST', json: v }), 'Expense recorded')) {
      setOpen(false);
      form.reset({ currency: v.currency, incurredOn: today(), category: 'OPERATING' });
      onSaved();
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> Record expense</Button></DialogTrigger>
      <DialogContent title="Record expense" description="Expenses without a channel are shared and allocated by revenue share.">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Category">
            <Select {...form.register('category')}>
              {['ADVERTISING', 'SOFTWARE', 'SAMPLES', 'CONTRACTOR', 'PLATFORM_FEES', 'OPERATING', 'OTHER'].map((c) => <option key={c} value={c}>{c.replace('_', ' ').toLowerCase()}</option>)}
            </Select>
          </Field>
          <Field label="Channel" error={e.channel?.message}>
            <Select {...form.register('channel', optional)}>
              <option value="">Shared (allocated)</option><option value="SHOPIFY_POD">Shopify POD</option><option value="AMAZON_MERCH">Amazon Merch</option><option value="DIGITAL">Digital</option>
            </Select>
          </Field>
          <div className="sm:col-span-2"><Field label="Description" error={e.description?.message}><Input {...form.register('description')} /></Field></div>
          <Field label="Vendor"><Input {...form.register('vendor', optional)} /></Field>
          <Field label="Date" error={e.incurredOn?.message}><Input type="date" {...form.register('incurredOn')} /></Field>
          <Field label="Amount" error={e.amount?.message}><Input inputMode="decimal" {...form.register('amount')} placeholder="0.00" /></Field>
          <Field label="Currency" error={e.currency?.message}><Input {...form.register('currency')} /></Field>
          <div className="flex justify-end sm:col-span-2"><Button type="submit" disabled={form.formState.isSubmitting}>Save expense</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PayoutDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<z.input<typeof payoutCreateSchema>>({ resolver: zodResolver(payoutCreateSchema), defaultValues: { source: 'AMAZON_MERCH', currency: 'USD' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    if (await mutate(() => api('/finance/payouts', { method: 'POST', json: v }), 'Payout recorded')) {
      setOpen(false);
      onSaved();
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> Record payout</Button></DialogTrigger>
      <DialogContent title="Record payout" description="Payouts are cash received for revenue already recognized. They never count as revenue.">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Source"><Select {...form.register('source')}><option value="AMAZON_MERCH">Amazon Merch</option><option value="SHOPIFY_PAYMENTS">Shopify Payments</option><option value="OTHER">Other</option></Select></Field>
          <Field label="Reference" error={e.externalId?.message}><Input {...form.register('externalId')} /></Field>
          <Field label="Period start" error={e.periodStart?.message}><Input type="date" {...form.register('periodStart')} /></Field>
          <Field label="Period end" error={e.periodEnd?.message}><Input type="date" {...form.register('periodEnd')} /></Field>
          <Field label="Amount" error={e.amount?.message}><Input inputMode="decimal" {...form.register('amount')} /></Field>
          <Field label="Currency" error={e.currency?.message}><Input {...form.register('currency')} /></Field>
          <Field label="Paid on" hint="Leave empty if still expected"><Input type="date" {...form.register('paidAt', optional)} /></Field>
          <Field label="Notes"><Input {...form.register('notes', optional)} /></Field>
          <div className="flex justify-end sm:col-span-2"><Button type="submit">Save payout</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RateDialog({ onSaved }: { onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<z.input<typeof exchangeRateCreateSchema>>({ resolver: zodResolver(exchangeRateCreateSchema), defaultValues: { quote: 'USD', rateDate: today() } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    if (await mutate(() => api('/finance/exchange-rates', { method: 'POST', json: v }), 'Exchange rate saved')) {
      setOpen(false);
      onSaved();
    }
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button><Plus /> Add rate</Button></DialogTrigger>
      <DialogContent title="Add exchange rate" description="1 base = rate quote, valid from the given date until a newer rate exists.">
        <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
          <Field label="Base" error={e.base?.message}><Input {...form.register('base')} placeholder="EUR" /></Field>
          <Field label="Quote" error={e.quote?.message}><Input {...form.register('quote')} /></Field>
          <Field label="Rate" error={e.rate?.message}><Input inputMode="decimal" {...form.register('rate')} placeholder="1.0850" /></Field>
          <Field label="Date" error={e.rateDate?.message}><Input type="date" {...form.register('rateDate')} /></Field>
          <div className="flex justify-end sm:col-span-2"><Button type="submit">Save rate</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
