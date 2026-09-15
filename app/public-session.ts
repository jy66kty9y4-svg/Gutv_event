'use client';
import { useEffect, useState } from 'react';
export type PublicSessionUser = { role: 'requester' | 'management'; displayName: string };
export function usePublicSession(initialSession: PublicSessionUser | null) {
  const [session, setSession] = useState(initialSession);
  useEffect(() => {
    let active = true;
    let latest = 0;
    const refresh = async () => {
      const current = ++latest;
      try {
        const response = await fetch('/api/auth/session', { cache: 'no-store' });
        if (!response.ok && response.status !== 401) return;
        const data = response.ok ? await response.json() : { user: null };
        if (active && current === latest) setSession(data.user || null);
      } catch { /* Keep the last verified session during a temporary network failure. */ }
    };
    void refresh();
    window.addEventListener('pageshow', refresh);
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('pageshow', refresh); window.removeEventListener('focus', refresh); };
  }, []);
  return session;
}
