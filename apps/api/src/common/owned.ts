import { NotFoundException } from '@nestjs/common';

/** Throws 404 for missing or other-organization records (never 403: do not leak existence). */
export function found<T>(record: T | null | undefined, entity: string): T {
  if (!record) throw new NotFoundException(`${entity} not found`);
  return record;
}
