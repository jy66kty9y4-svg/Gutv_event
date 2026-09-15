'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { ThemeSwitcher } from './theme-switcher';
import { PublicFooter, PublicHeader } from './public-chrome';
import { PublicContacts, PublicRequestGuidance, publicSupport } from './public-request-guidance';
import { useDialogFocus } from './use-dialog-focus';
import { AUTH_LIMITS, normalizedUsername, registrationFields, registrationValidationError } from './auth-validation';

type AuthMode = 'login' | 'register' | null;
import { usePublicSession, type PublicSessionUser as SessionUser } from './public-session';

const REGISTRATION_DRAFT_KEY = 'gutv-registration-draft-v1';
type PublicRequestKind = 'event' | 'video' | '';
const emptyRegistration = { organizationType: 'faculty', organizationName: '', representativeName: '', contact: '', username: '' };
type RegistrationDraft = typeof emptyRegistration;

function readRegistrationDraft(): RegistrationDraft {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(REGISTRATION_DRAFT_KEY) || 'null');
    if (!saved || typeof saved !== 'object') return { ...emptyRegistration };
    return {
      organizationType: saved.organizationType === 'organization' ? 'organization' : 'faculty',
      organizationName: typeof saved.organizationName === 'string' ? saved.organizationName.slice(0, AUTH_LIMITS.organizationName.max) : '',
      representativeName: typeof saved.representativeName === 'string' ? saved.representativeName.slice(0, AUTH_LIMITS.representativeName.max) : '',
      contact: typeof saved.contact === 'string' ? saved.contact.slice(0, AUTH_LIMITS.contact.max) : '',
      username: typeof saved.username === 'string' ? saved.username.slice(0, AUTH_LIMITS.username.max) : '',
    };
  } catch { return { ...emptyRegistration }; }
}

function nextDestination(role: SessionUser['role'], requestIntent = false, returnTo = '', kind: PublicRequestKind = '') {
  if (role === 'management') return /^\/management(?:[/?]|$)/.test(returnTo) ? returnTo : '/management';
  if (requestIntent) return `/cabinet?new=1${kind ? `&kind=${kind}` : ''}`;
  return /^\/cabinet(?:[/?]|$)/.test(returnTo) ? returnTo : '/cabinet';
}

export default function PublicHome({ initialSession }: { initialSession: SessionUser | null }) {
  const searchParams = useSearchParams();
  const [authMode, setAuthMode] = useState<AuthMode>(null);
  const [requestIntent, setRequestIntent] = useState(false);
  const [returnTo, setReturnTo] = useState('');
  const [requestKind, setRequestKind] = useState<PublicRequestKind>('');
  const session = usePublicSession(initialSession);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [registered, setRegistered] = useState(false);
  const [registrationDraft, setRegistrationDraft] = useState<RegistrationDraft>({ ...emptyRegistration });
  const [registeredUsername, setRegisteredUsername] = useState('');
  const dialogRef = useRef<HTMLElement>(null);
  const requestPending = useRef(false);
  const closeAuth = useCallback(() => {
    if (requestPending.current) return;
    setAuthMode(null);
    const url = new URL(window.location.href);
    url.searchParams.delete('auth');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);
  useDialogFocus({ open: Boolean(authMode && !session), dialogRef, onClose: closeAuth });

  function updateRegistrationDraft<K extends keyof RegistrationDraft>(field: K, value: RegistrationDraft[K]) {
    const next = { ...registrationDraft, [field]: value };
    setRegistrationDraft(next);
    try { window.sessionStorage.setItem(REGISTRATION_DRAFT_KEY, JSON.stringify(next)); } catch { /* In-memory draft still works when storage is unavailable. */ }
  }

  useEffect(() => {
    const queryTimer = window.setTimeout(() => {
      const query = searchParams;
      setRegistrationDraft(readRegistrationDraft());
      const kind = query.get('kind');
      setRequestKind(kind === 'event' || kind === 'video' ? kind : '');
      const requestedMode = query.get('auth');
      if (requestedMode === 'login' || requestedMode === 'register') setAuthMode(requestedMode);
      setRequestIntent(query.get('intent') === 'request');
      setReturnTo(query.get('returnTo') || '');
    }, 0);
    return () => window.clearTimeout(queryTimer);
  }, [searchParams]);

  useEffect(() => {
    if (session && authMode) {
      window.location.replace(nextDestination(session.role, requestIntent, returnTo, requestKind));
      return;
    }
  }, [authMode, session, requestIntent, returnTo, requestKind]);

  useEffect(() => {
    if (!authMode || session) return;
    const frame = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>('[data-dialog-initial-focus]')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [authMode, registered, session]);

  function openAuth(mode: Exclude<AuthMode, null>, fromRequest = false) {
    if (requestPending.current) return;
    setRequestIntent(fromRequest);
    setError('');
    setAuthMode(mode);
  }

  function startRequest() {
    setRequestKind('');
    if (session) {
      window.location.assign(nextDestination(session.role, true));
      return;
    }
    openAuth('login', true);
  }

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestPending.current) return;
    requestPending.current = true;
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const username = normalizedUsername(String(form.get('username') || ''));
    const password = String(form.get('password') || '');
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const result = await response.json() as { error?: string; user?: SessionUser };
      if (!response.ok || !result.user) throw new Error(result.error || 'Не удалось войти');
      window.location.assign(nextDestination(result.user.role, requestIntent, returnTo, requestKind));
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : 'Не удалось войти');
      requestPending.current = false;
      setSubmitting(false);
    }
  }

  async function register(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (requestPending.current) return;
    requestPending.current = true;
    setSubmitting(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const body = Object.fromEntries(form.entries());
      const fields = registrationFields(body);
      const validationError = registrationValidationError(fields, body);
      if (validationError) throw new Error(validationError);
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || 'Не удалось отправить регистрацию');
      setRegisteredUsername(fields.username);
      setRegistered(true);
      setRegistrationDraft({ ...emptyRegistration });
      try { window.sessionStorage.removeItem(REGISTRATION_DRAFT_KEY); } catch { /* Storage is optional. */ }
    } catch (registerError) {
      setError(registerError instanceof Error ? registerError.message : 'Не удалось отправить регистрацию');
    } finally {
      requestPending.current = false;
      setSubmitting(false);
    }
  }

  return <div className="public-site">
    <PublicHeader active="home" initialSession={initialSession} onLogin={() => openAuth('login', requestIntent)} onRegister={() => openAuth('register', requestIntent)} onRequest={startRequest} />

    <main id="public-main">
      <section className="public-hero" aria-labelledby="public-title">
        <div className="public-hero-copy">
          <div className="public-kicker"><i /> ГУТВ · Эфир университета</div>
          <h1 id="public-title">Событие<br /><em>в кадре.</em></h1>
          <p>Расскажите о вашем событии. Мы соберём команду, подготовим технику и сохраним главное в кадре.</p>
          <div className="public-hero-actions">
            <button className="public-primary" type="button" onClick={startRequest}><span>Оставить заявку на съёмку</span><b aria-hidden="true">→</b></button>
            {!session && <p className="public-account-note">Перед первой заявкой зарегистрируйте организацию и дождитесь проверки аккаунта ГУТВ.</p>}
            <a href="#request-guide">Как подать заявку и сроки</a>
            <Link href="/studio">Познакомиться со студией</Link>
          </div>
        </div>
        <div className="public-signal public-signal-photo">
          <Image
            className="public-signal-image"
            src="/gutv-hero-camera.webp"
            width={1536}
            height={1024}
            sizes="(max-width: 980px) calc(100vw - 34px), 45vw"
            alt="Монитор съёмочной камеры с эфирной заставкой ГУТВ"
            priority
          />
        </div>
        <span className="public-hero-index" aria-hidden="true">01 / SIGNAL</span>
      </section>

      <PublicRequestGuidance />
      <PublicContacts />
    </main>
    <PublicFooter />

    {authMode && !session && <div className="auth-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAuth(); }}>
      <section ref={dialogRef} className={`auth-dialog ${authMode === 'register' ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="auth-title" aria-busy={submitting} tabIndex={-1}>
        <button className="auth-close" type="button" onClick={closeAuth} disabled={submitting} aria-label="Закрыть">×</button>
        <ThemeSwitcher className="auth-theme-switcher" />
        <div className="auth-brand"><Image src="/design/gutv-mark.svg" width={58} height={58} alt="" /><span><small>SEC · ACCESS</small><b>Единый вход ГУТВ</b></span></div>
        {authMode === 'login' ? <>
          <div className="auth-copy"><span>Личный кабинет</span><h2 id="auth-title">Вход</h2><p>Введите логин и пароль вашей учётной записи.</p></div>
          {requestIntent && <p className="auth-intent">После входа откроется заявка{requestKind === 'video' ? ' на создание видеоролика' : requestKind === 'event' ? ' на съёмку мероприятия' : ' на съёмку'}.</p>}
          <form onSubmit={login}>
            <label><span>Логин</span><input name="username" type="text" inputMode="text" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={AUTH_LIMITS.username.min} maxLength={AUTH_LIMITS.username.max} required data-dialog-initial-focus defaultValue={registeredUsername || registrationDraft.username} disabled={submitting} /></label>
            <label><span>Пароль</span><input name="password" type="password" inputMode="text" autoComplete="current-password" maxLength={AUTH_LIMITS.password.max} required disabled={submitting} /></label>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="auth-submit" type="submit" disabled={submitting}>{submitting ? 'Проверяем…' : 'Войти'}<b aria-hidden="true">→</b></button>
          </form>
          <p className="auth-help">Забыли пароль или не получается войти? <a href={publicSupport.registration.href} target="_blank" rel="noopener noreferrer">Написать директору ГУТВ в Telegram ↗</a></p>
          <p className="auth-switch">Нет аккаунта? <button disabled={submitting} type="button" onClick={() => openAuth('register', requestIntent)}>Зарегистрироваться</button></p>
        </> : registered ? <div className="auth-success"><i aria-hidden="true">✓</i><h2 id="auth-title" tabIndex={-1} data-dialog-initial-focus>Регистрация на проверке</h2><p>Данные отправлены в ГУТВ. Вход будет доступен после подтверждения организации.</p><p>Ваш логин: <strong>{registeredUsername}</strong>. Чтобы уточнить статус, напишите директору студии и укажите этот логин или название организации.</p><a className="auth-support-link" href={publicSupport.registration.href} target="_blank" rel="noopener noreferrer">Уточнить у директора в Telegram ↗</a><button type="button" onClick={() => openAuth('login', requestIntent)}>Войти после подтверждения</button></div> : <>
          <div className="auth-copy"><span>Новый аккаунт</span><h2 id="auth-title">Регистрация</h2><p>Один общий кабинет для факультета или организации. Сначала ГУТВ проверит данные, затем вы сможете подать заявку.</p></div>
          <p className="auth-draft-note">Заполненные данные сохранятся в этой вкладке, если закрыть окно. Пароль понадобится ввести заново.</p>
          <form className="auth-register-form" onSubmit={register}>
            <label><span>Тип подразделения</span><select name="organizationType" value={registrationDraft.organizationType} onChange={event => updateRegistrationDraft('organizationType', event.target.value)} required data-dialog-initial-focus disabled={submitting}><option value="faculty">Факультет</option><option value="organization">Организация</option></select></label>
            <label><span>Название · до 120 символов</span><input name="organizationName" value={registrationDraft.organizationName} onChange={event => updateRegistrationDraft('organizationName', event.target.value)} disabled={submitting} type="text" minLength={AUTH_LIMITS.organizationName.min} maxLength={AUTH_LIMITS.organizationName.max} required /></label>
            <label><span>Контактное лицо · до 120 символов</span><input name="representativeName" value={registrationDraft.representativeName} onChange={event => updateRegistrationDraft('representativeName', event.target.value)} disabled={submitting} type="text" minLength={AUTH_LIMITS.representativeName.min} maxLength={AUTH_LIMITS.representativeName.max} required /></label>
            <label><span>Телефон или Telegram · до 120 символов</span><input name="contact" value={registrationDraft.contact} onChange={event => updateRegistrationDraft('contact', event.target.value)} disabled={submitting} type="text" minLength={AUTH_LIMITS.contact.min} maxLength={AUTH_LIMITS.contact.max} placeholder="+7… или @username" required /></label>
            <label><span>Логин · 3–60 символов</span><input name="username" value={registrationDraft.username} onChange={event => updateRegistrationDraft('username', event.target.value)} disabled={submitting} type="text" inputMode="text" autoComplete="username" autoCapitalize="none" spellCheck={false} minLength={AUTH_LIMITS.username.min} maxLength={AUTH_LIMITS.username.max} aria-describedby="register-username-hint" required /><small id="register-username-hint">Русские и латинские буквы, цифры, точка, дефис и подчёркивание. Без пробелов.</small></label>
            <label><span>Пароль · 8–200 символов</span><input name="password" type="password" inputMode="text" autoComplete="new-password" minLength={AUTH_LIMITS.password.min} maxLength={AUTH_LIMITS.password.max} aria-describedby="register-password-hint" disabled={submitting} required /><small id="register-password-hint">Русские буквы разрешены. Регистр букв учитывается. Пароль не сохраняется в черновике.</small></label>
            {error && <p className="auth-error span-all" role="alert">{error}</p>}
            <button className="auth-submit span-all" type="submit" disabled={submitting}>{submitting ? 'Отправляем…' : 'Отправить регистрацию'}<b aria-hidden="true">→</b></button>
          </form>
          <button className="auth-draft-close" type="button" disabled={submitting} onClick={closeAuth}>Закрыть, сохранив данные</button>
          <p className="auth-switch">Уже есть аккаунт? <button disabled={submitting} type="button" onClick={() => openAuth('login', requestIntent)}>Войти</button></p>
        </>}
        {submitting && <p className="auth-busy" role="status">Дождитесь завершения отправки. Окно можно будет закрыть после ответа.</p>}
      </section>
    </div>}
  </div>;
}
