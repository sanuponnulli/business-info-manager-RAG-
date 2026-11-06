/**
 * Remembers the admin key for this browser tab only (sessionStorage is
 * cleared when the tab closes). Storage can be blocked, e.g. in private
 * windows, so every access is wrapped: the app then just asks again.
 */
const STORAGE_KEY = "handbook-admin-key";

export function loadAdminKey(): string | null {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveAdminKey(key: string): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Not fatal: the key still lives in React state until the page reloads.
  }
}

export function clearAdminKey(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
