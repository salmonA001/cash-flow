'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState, LoadingRows } from './states';
import { Button } from './ui/button';
import { Table, TBody, TD, TH, THead, TR } from './ui/table';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface Props<T> {
  columns: Column<T>[];
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  isLoading?: boolean;
  error?: unknown;
  empty: { title: string; description?: string; action?: ReactNode };
  onRowClick?: (row: T) => void;
  pagination?: { page: number; pageSize: number; total: number; onPage: (page: number) => void };
}

export function DataTable<T>({ columns, rows, rowKey, isLoading, error, empty, onRowClick, pagination }: Props<T>) {
  if (error) return <ErrorState error={error} />;
  if (isLoading || !rows) return <LoadingRows />;
  if (rows.length === 0) return <EmptyState {...empty} />;
  const pages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.pageSize)) : 1;
  return (
    <div>
      <Table>
        <THead>
          <tr>{columns.map((c) => <TH key={c.header} className={c.className}>{c.header}</TH>)}</tr>
        </THead>
        <TBody>
          {rows.map((row) => (
            <TR key={rowKey(row)} onClick={onRowClick ? () => onRowClick(row) : undefined} className={cn(onRowClick && 'cursor-pointer')}>
              {columns.map((c) => <TD key={c.header} className={c.className}>{c.cell(row)}</TD>)}
            </TR>
          ))}
        </TBody>
      </Table>
      {pagination && pagination.total > pagination.pageSize && (
        <div className="flex items-center justify-between border-t px-3 py-2 text-xs text-muted-foreground">
          <span>{pagination.total} total · page {pagination.page} of {pages}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="icon" aria-label="Previous page" disabled={pagination.page <= 1} onClick={() => pagination.onPage(pagination.page - 1)}><ChevronLeft /></Button>
            <Button variant="ghost" size="icon" aria-label="Next page" disabled={pagination.page >= pages} onClick={() => pagination.onPage(pagination.page + 1)}><ChevronRight /></Button>
          </div>
        </div>
      )}
    </div>
  );
}
