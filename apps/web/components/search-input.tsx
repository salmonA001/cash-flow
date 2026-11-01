'use client';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from './ui/input';

/** Debounced search box. */
export function SearchInput({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => local !== value && onChange(local), 300);
    return () => clearTimeout(t);
  }, [local, value, onChange]);
  return (
    <div className="relative w-full sm:w-64">
      <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
      <Input aria-label="Search" value={local} onChange={(e) => setLocal(e.target.value)} placeholder={placeholder} className="pl-8" />
    </div>
  );
}
