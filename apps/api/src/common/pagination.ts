import type { Paginated } from '@cfe/shared-types';
import type { PaginationQuery } from '@cfe/validation';

export function pageArgs(q: PaginationQuery) {
  return { skip: (q.page - 1) * q.pageSize, take: q.pageSize };
}

export function paginated<T>(items: T[], total: number, q: PaginationQuery): Paginated<T> {
  return { items, total, page: q.page, pageSize: q.pageSize };
}

/** Only whitelisted fields may be sorted on; anything else falls to the default. */
export function orderBy<F extends string>(q: PaginationQuery, allowed: readonly F[], defaultField: F) {
  const field = (allowed as readonly string[]).includes(q.sort ?? '') ? (q.sort as F) : defaultField;
  return { [field]: q.order } as Record<F, 'asc' | 'desc'>;
}
