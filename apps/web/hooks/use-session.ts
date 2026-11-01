'use client';
import { useApi } from './use-api';

export interface SessionUser {
  id: string;
  organizationId: string;
  email: string;
  name: string;
  roleName: string;
  permissions: string[];
}

export function useSession() {
  const { data, error, isLoading } = useApi<SessionUser>('/auth/me');
  return { user: data, error, isLoading, can: (p: string) => !!data?.permissions.includes(p) };
}
