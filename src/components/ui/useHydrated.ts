"use client";

import { useSyncExternalStore } from "react";

/**
 * `false` on the server and during the first client render, `true` after.
 *
 * The usual way to write this is `useState(false)` plus a
 * `useEffect(() => setMounted(true))`, which works but schedules a second
 * render pass on every mount. `useSyncExternalStore` expresses the same thing
 * with a differing server snapshot, so React handles it in one pass and the
 * hydration output still matches the server markup.
 *
 * Use it to gate anything that can only be known in the browser: portals,
 * values read out of `localStorage`, media queries.
 */

const NEVER_CHANGES = () => () => {};
const ON_CLIENT = () => true;
const ON_SERVER = () => false;

export function useHydrated(): boolean {
  return useSyncExternalStore(NEVER_CHANGES, ON_CLIENT, ON_SERVER);
}

/** Subscribe to `localStorage` writes made anywhere in the app or another tab. */
const storageListeners = new Set<() => void>();

export function notifyStorageChanged(): void {
  for (const listener of storageListeners) listener();
}

export function subscribeToStorage(listener: () => void): () => void {
  storageListeners.add(listener);
  const onStorage = () => listener();
  window.addEventListener("storage", onStorage);
  return () => {
    storageListeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    // Private browsing, or storage disabled. "Unset" is the right answer.
    return null;
  }
}

export function writeLocalStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Not persisting a preference is survivable; don't break the page.
  }
  notifyStorageChanged();
}

/** A single `localStorage` key, read reactively. */
export function useStoredString(
  key: string,
): [string | null, (value: string | null) => void] {
  const value = useSyncExternalStore(
    subscribeToStorage,
    () => readLocalStorage(key),
    () => null,
  );
  return [value, (next) => writeLocalStorage(key, next)];
}
