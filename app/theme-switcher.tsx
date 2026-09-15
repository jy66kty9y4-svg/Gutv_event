'use client';

import { useSyncExternalStore } from 'react';

type ThemeMode = 'light' | 'dark' | 'auto';

const storageKey = 'gutv-interface-theme';
const modes: ThemeMode[] = ['light', 'dark', 'auto'];
const listeners = new Set<() => void>();
let currentMode: ThemeMode = 'auto';
let listening = false;

function validMode(value: unknown): ThemeMode {
  return typeof value === 'string' && modes.includes(value as ThemeMode) ? value as ThemeMode : 'auto';
}

function resolvedTheme(mode: ThemeMode) {
  return mode === 'auto'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    : mode;
}

function applyTheme(mode: ThemeMode, persist = false) {
  const theme = resolvedTheme(mode);
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#040711' : '#f4f8fc');
  if (persist) {
    try {
      window.localStorage.setItem(storageKey, mode);
    } catch {
      // A blocked storage area must not prevent the live theme or controls from updating.
    }
  }
}

function notify() {
  listeners.forEach((listener) => listener());
}

function setMode(mode: ThemeMode, persist = false) {
  currentMode = mode;
  applyTheme(mode, persist);
  notify();
}

function syncFromDocument() {
  const documentMode = document.documentElement.dataset.themeMode;
  if (documentMode) {
    currentMode = validMode(documentMode);
    return;
  }
  try {
    currentMode = validMode(window.localStorage.getItem(storageKey));
  } catch {
    currentMode = 'auto';
  }
}

function startListening() {
  if (listening || typeof window === 'undefined') return;
  listening = true;
  syncFromDocument();
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change', () => {
    if (currentMode === 'auto') applyTheme('auto');
  });
  window.addEventListener('storage', (event) => {
    if (event.key === storageKey) setMode(validMode(event.newValue));
  });
}

function subscribe(listener: () => void) {
  startListening();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function clientSnapshot() {
  startListening();
  return currentMode;
}

function serverSnapshot(): ThemeMode {
  return 'auto';
}

function Icon({ mode }: { mode: ThemeMode }) {
  if (mode === 'light') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>;
  if (mode === 'dark') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.1A8.5 8.5 0 0 1 8.9 4 8.5 8.5 0 1 0 20 15.1Z" /></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>;
}

export function ThemeSwitcher({ className = '' }: { className?: string }) {
  const mode = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const choices: { value: ThemeMode; label: string }[] = [
    { value: 'light', label: 'Светлая тема' },
    { value: 'dark', label: 'Тёмная тема' },
    { value: 'auto', label: 'Как на устройстве' },
  ];

  return <div className={`theme-switcher ${className}`.trim()} role="group" aria-label="Тема интерфейса">
    {choices.map((choice) => <button
      key={choice.value}
      type="button"
      data-theme-choice={choice.value}
      className={mode === choice.value ? 'active' : ''}
      aria-label={choice.label}
      aria-pressed={mode === choice.value}
      title={choice.label}
      onClick={() => setMode(choice.value, true)}
    ><Icon mode={choice.value} /></button>)}
  </div>;
}
