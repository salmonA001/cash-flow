'use client';
import { useCallback, useState } from 'react';
import { qs } from '@/lib/api';
import type { Paginated } from '@/types/api';
import { useApi } from './use-api';

/** Paginated, searchable, filterable list state for a /api/v1 collection endpoint. */
export function useList<T>(path: string, initialFilters: Record<string, string> = {}, pageSize = 25) {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [filters, setFilters] = useState(initialFilters);
  const query = useApi<Paginated<T>>(`${path}${qs({ page, pageSize, q, ...filters })}`);
  const setSearch = useCallback((v: string) => { setQ(v); setPage(1); }, []);
  const setFilter = useCallback((key: string, value: string) => { setFilters((f) => ({ ...f, [key]: value })); setPage(1); }, []);
  return {
    ...query,
    q,
    setSearch,
    filters,
    setFilter,
    pagination: query.data ? { page, pageSize, total: query.data.total, onPage: setPage } : undefined,
  };
}
