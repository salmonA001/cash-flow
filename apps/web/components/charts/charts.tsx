'use client';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatMoney } from '@/lib/format';

const COLORS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'];
const axis = { stroke: 'var(--muted-foreground)', fontSize: 11, tickLine: false, axisLine: false } as const;
const tooltipStyle = { background: 'var(--card-solid)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12 };

export interface SeriesDef {
  key: string;
  label: string;
}

/** Grouped bars: each series stays separate (sales and royalties are different revenue stages). */
export function GroupedBarChart({ data, xKey, series, currency, height = 260 }: { data: Record<string, string | number>[]; xKey: string; series: SeriesDef[]; currency: string; height?: number }) {
  const rows = data.map((d) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, k === xKey ? v : Number(v)])));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--border)" />
        <XAxis dataKey={xKey} {...axis} />
        <YAxis {...axis} width={56} tickFormatter={(v: number) => formatMoney(v, currency).replace(/\.00$/, '')} />
        <Tooltip contentStyle={tooltipStyle} cursor={{ fill: 'var(--muted)', opacity: 0.5 }} formatter={(v) => formatMoney(Number(v), currency)} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
        {series.map((s, i) => (
          <Bar key={s.key} dataKey={s.key} name={s.label} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={28} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DonutChart({ data, currency, height = 220 }: { data: { name: string; value: number }[]; currency: string; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie data={data} dataKey="value" nameKey="name" innerRadius="58%" outerRadius="85%" paddingAngle={2} stroke="none">
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatMoney(Number(v), currency)} />
        <Legend wrapperStyle={{ fontSize: 12 }} iconType="circle" iconSize={8} />
      </PieChart>
    </ResponsiveContainer>
  );
}
