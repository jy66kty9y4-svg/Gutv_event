'use client';

import Link from 'next/link';
type PublicNavigationProps = {
  active?: 'home' | 'studio' | 'directions';
  className: string;
};

export function PublicNavigation({ active, className }: PublicNavigationProps) {
  return <nav className={className} aria-label="Основная навигация">
    <Link className={active === 'home' ? 'active' : ''} aria-current={active === 'home' ? 'page' : undefined} href="/">Главная</Link>
    <Link className={active === 'studio' ? 'active' : ''} aria-current={active === 'studio' ? 'page' : undefined} href="/studio">О студии</Link>
    <Link className={active === 'directions' ? 'active' : ''} aria-current={active === 'directions' ? 'page' : undefined} href="/directions">Направления</Link>
  </nav>;
}
