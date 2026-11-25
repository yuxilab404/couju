import { useSyncExternalStore } from 'react';
import { appPath, href } from '../base.ts';

export type Route =
  | { name: 'lobby' }
  | { name: 'room'; roomId: string | null }
  | { name: 'me' }
  | { name: 'admin' }
  | { name: 'login' };

const listeners = new Set<() => void>();
window.addEventListener('popstate', () => listeners.forEach((l) => l()));

export function navigate(path: string, replace = false): void {
  if (replace) history.replaceState(null, '', href(path));
  else history.pushState(null, '', href(path));
  listeners.forEach((l) => l());
}

export function parseRoute(path: string): Route {
  const m = /^\/room\/([a-z0-9]+)\/?$/.exec(path);
  if (m) return { name: 'room', roomId: m[1] === 'new' ? null : m[1] };
  if (path === '/me') return { name: 'me' };
  if (path === '/admin') return { name: 'admin' };
  if (path === '/login') return { name: 'login' };
  return { name: 'lobby' };
}

export function usePath(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => appPath(location.pathname),
  );
}
