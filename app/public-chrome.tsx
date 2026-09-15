'use client';

import Image from 'next/image';
import { usePublicSession, type PublicSessionUser } from './public-session';
import Link from 'next/link';
import { socialLinks } from './public-content';
import { PublicNavigation } from './public-navigation';
import { ThemeSwitcher } from './theme-switcher';

type PublicChromeProps = {
  initialSession: PublicSessionUser | null;
  active?: 'home' | 'studio' | 'directions';
  accountLabel?: string;
  onAccount?: () => void;
  onLogin?: () => void;
  onRegister?: () => void;
  onRequest?: () => void;
};

export function PublicHeader({
  initialSession,
  active,
  accountLabel,
  onAccount,
  onLogin,
  onRegister,
  onRequest,
}: PublicChromeProps) {
  const session = usePublicSession(initialSession);
  const accountHref = session?.role === 'management' ? '/management' : '/cabinet';
  return <>
    <a className="public-skip-link" href="#public-main">К содержимому</a>
    <div className="studio-service-line">
      <span><i /> GUTV · CHANNEL ONLINE</span>
      <span>РГУ нефти и газа (НИУ) имени И.М. Губкина</span>
      <span className="studio-service-links">
        <a href={socialLinks.telegram} target="_blank" rel="noreferrer">Telegram ↗</a>
        <a href={socialLinks.vk} target="_blank" rel="noreferrer">VK ↗</a>
      </span>
    </div>
    <header className="studio-header public-shared-header">
      <Link className="studio-brand" href="/" aria-label="ГУТВ — на главную">
        <Image src="/design/gutv-mark.svg" width={50} height={50} alt="" priority />
        <span><b>гутв</b><small>Студенческое телевидение</small></span>
      </Link>
      <PublicNavigation active={active} className="studio-nav" />
      <div className="studio-header-actions">
        <ThemeSwitcher />
        {onRequest
          ? <button className="studio-request-link" type="button" onClick={onRequest}>Заявка на съёмку <span>→</span></button>
          : <Link className="studio-request-link" href={session ? (session.role === 'management' ? '/management' : '/cabinet?new=1') : '/?auth=login&intent=request'}>Заявка на съёмку <span>→</span></Link>}
        <div className="public-account-actions">
        {session ? <Link className="studio-account-link" href={accountHref}>Личный кабинет</Link> : accountLabel && onAccount
          ? <button className="studio-account-link" type="button" onClick={onAccount}>{accountLabel}</button>
          : onLogin
            ? <button className="studio-account-link" type="button" onClick={onLogin}>Войти</button>
            : <Link className="studio-account-link" href="/?auth=login">Войти</Link>}
        {!session && !accountLabel && (onRegister
          ? <button className="studio-register-link" type="button" onClick={onRegister}>Регистрация</button>
          : <Link className="studio-register-link" href="/?auth=register">Регистрация</Link>)}
        </div>
      </div>
    </header>
  </>;
}

export function PublicFooter() {
  return <footer className="studio-footer">
    <div>
      <Link className="studio-brand" href="/">
        <Image src="/design/gutv-mark.svg" width={44} height={44} alt="" />
        <span><b>гутв</b><small>Студенческое телевидение</small></span>
      </Link>
      <p>Университет. Люди. События.<br />В кадре — настоящее.</p>
    </div>
    <nav aria-label="Ссылки в подвале">
      <Link href="/">Главная</Link>
      <Link href="/studio#latest-projects">Последние работы</Link>
      <Link href="/studio">О студии</Link>
      <Link href="/directions">Направления</Link>
      <Link href="/#request-guide">Как подать заявку</Link>
      <Link href="/#public-rules">Правила</Link>
      <Link href="/#contacts">Контакты и помощь</Link>
      <Link href="/?auth=login&intent=request">Оставить заявку</Link>
    </nav>
    <div className="studio-socials">
      <a href={socialLinks.telegram} target="_blank" rel="noreferrer">Telegram <span>↗</span></a>
      <a href={socialLinks.vk} target="_blank" rel="noreferrer">VK <span>↗</span></a>
      <a href="https://max.ru/id7736093127_gos" target="_blank" rel="noreferrer">MAX <span>↗</span></a>
      <small>© {new Date().getFullYear()} ГУТВ</small>
    </div>
  </footer>;
}
