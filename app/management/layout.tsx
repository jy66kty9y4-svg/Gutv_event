import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Рабочее пространство · ГУТВ',
  robots: { index: false, follow: false },
};

export default function ManagementLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
