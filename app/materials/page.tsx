import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Последние проекты — ГУТВ',
  description: 'Последние материалы студенческой телестудии ГУТВ.',
};

export default function MaterialsPage() {
  redirect('/studio#latest-projects');
}
