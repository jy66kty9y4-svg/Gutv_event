import type { Metadata } from 'next';
import './globals.css';
import './public-site.css';
import './theme.css';
import './design-refresh.css';
import './public-audit.css';

const themeBootstrap = `(() => {
  try {
    const saved = localStorage.getItem('gutv-interface-theme');
    const mode = saved === 'light' || saved === 'dark' ? saved : 'auto';
    const theme = mode === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : mode === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.themeMode = mode;
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#040711' : '#f4f8fc');
  } catch {
    document.documentElement.dataset.themeMode = 'auto';
    document.documentElement.dataset.theme = 'dark';
    document.documentElement.style.colorScheme = 'dark';
  }
})();`;

export const metadata: Metadata = {
  metadataBase: new URL('https://gutv.tech'),
  title: 'ГУТВ — студенческое телевидение',
  description: 'Материалы, проекты и заявки на съёмку студенческой телестудии ГУТВ Губкинского университета.',
  openGraph: {
    title: 'ГУТВ — студенческое телевидение',
    description: 'Материалы, проекты и заявки на съёмку студенческой телестудии ГУТВ.',
    type: 'website',
  },
  twitter: {
    card: 'summary',
    title: 'ГУТВ — студенческое телевидение',
    description: 'Материалы, проекты и заявки на съёмку студенческой телестудии ГУТВ.',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <head><meta name="theme-color" content="#040711" /><script dangerouslySetInnerHTML={{ __html: themeBootstrap }} /></head>
      <body>{children}</body>
    </html>
  );
}
