'use client';

import { useEffect, useRef, type RefObject } from 'react';

/** Keep modal focus and background interaction consistent across the portal. */
export function useDialogFocus({ open, dialogRef, onClose }: {
  open: boolean;
  dialogRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}) {
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousTabIndex = dialog.getAttribute('tabindex');
    dialog.setAttribute('tabindex', '-1');
    document.body.style.overflow = 'hidden';

    // Only siblings outside the dialog's ancestor chain become inert.
    const background: Array<{ element: HTMLElement; inert: boolean }> = [];
    let branch: HTMLElement = dialog;
    while (branch.parentElement) {
      for (const sibling of branch.parentElement.children) {
        if (sibling !== branch && sibling instanceof HTMLElement) {
          background.push({ element: sibling, inert: sibling.inert });
          sibling.setAttribute('inert', '');
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }

    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')]
      .filter(element => !element.matches(':disabled,[hidden]') && element.tabIndex >= 0
        && !element.closest('[inert]') && element.getClientRects().length > 0
        && getComputedStyle(element).visibility !== 'hidden');
    const focusInside = () => {
      const elements = focusable();
      const preferred = elements.find(element => element.hasAttribute('autofocus')) || elements[0] || dialog;
      preferred.focus({ preventScroll: true });
    };
    const focusFrame = requestAnimationFrame(() => {
      if (!dialog.contains(document.activeElement)) focusInside();
    });
    const onFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) focusInside();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current();
      } else if (event.key === 'Tab') {
        const elements = focusable();
        const first = elements[0], last = elements.at(-1);
        if (!first) { event.preventDefault(); dialog.focus(); return; }
        const active = document.activeElement;
        if (event.shiftKey && (active === first || !elements.includes(active as HTMLElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (active === last || !elements.includes(active as HTMLElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    const observer = new MutationObserver(() => {
      if (!dialog.contains(document.activeElement)) focusInside();
    });
    observer.observe(dialog, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(focusFrame);
      observer.disconnect();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      for (const item of background) item.element.toggleAttribute('inert', item.inert);
      document.body.style.overflow = previousOverflow;
      if (previousTabIndex === null) dialog.removeAttribute('tabindex');
      else dialog.setAttribute('tabindex', previousTabIndex);
      if (previousFocus?.isConnected && !previousFocus.closest('[inert]')) previousFocus.focus({ preventScroll: true });
    };
  }, [open, dialogRef]);
}
