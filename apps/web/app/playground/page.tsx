import type { Metadata } from 'next';
import { Playground } from '@/components/playground/playground';

export const metadata: Metadata = { title: 'Liquid playground' };

export default function PlaygroundPage() {
  return <Playground />;
}
