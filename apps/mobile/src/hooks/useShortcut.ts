import { useEffect } from 'react';

/** Accepts a key (Escape, F2, etc.) or Ctrl+key. The DOM is absent on native. */
export function useShortcut(shortcut: string, handler?: () => void) {
  useEffect(() => {
    if (typeof document === 'undefined' || !handler) return;
    function onKey(event: KeyboardEvent) {
      const ctrl = shortcut.startsWith('Ctrl+');
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.shiftKey ||
        ctrl !== (event.ctrlKey || event.metaKey) ||
        event.key.toLowerCase() !== shortcut.replace(/^Ctrl\+/, '').toLowerCase()
      )
        return;
      if (
        !ctrl &&
        event.key.length === 1 &&
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName))
      )
        return;
      event.preventDefault();
      handler?.();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [shortcut, handler]);
}
