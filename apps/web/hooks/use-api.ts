'use client';
import useSWR, { SWRConfiguration } from 'swr';
import { fetcher } from '@/lib/api';

/** Read hook for /api/v1 paths. Pass null to skip. */
export function useApi<T>(path: string | null, config?: SWRConfiguration<T>) {
  return useSWR<T>(path, fetcher, { revalidateOnFocus: false, ...config });
}
