/**
 * Operator credential for the admin-gated API endpoints.
 *
 * The API authenticates admin mutations (proposal create/finalize/execute,
 * outcome recording, signal collection, issue detection, deliberation) with a
 * shared key. The browser has to be able to send it, so it is held here.
 *
 * Deliberately sessionStorage, not localStorage: the credential dies with the
 * tab instead of persisting on the machine. It is still a shared operator
 * secret visible to anything running in the page — it is not a substitute for
 * per-user accounts, and only someone already operating this deployment should
 * ever enter one.
 */

const STORAGE_KEY = "oracle.adminApiKey";

type Listener = (key: string | null) => void;
const listeners = new Set<Listener>();

export function getAdminKey(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    // Private-mode / storage-disabled browsers.
    return null;
  }
}

export function setAdminKey(key: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (key && key.trim()) {
      window.sessionStorage.setItem(STORAGE_KEY, key.trim());
    } else {
      window.sessionStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Ignore: the caller still gets the notification below and the UI will
    // simply behave as if no key were stored.
  }
  const current = getAdminKey();
  listeners.forEach((l) => l(current));
}

export function hasAdminKey(): boolean {
  return Boolean(getAdminKey());
}

/** Subscribe to key changes; returns an unsubscribe function. */
export function subscribeAdminKey(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Header set to attach to an admin request, empty when no key is held. */
export function adminHeaders(): Record<string, string> {
  const key = getAdminKey();
  return key ? { "x-admin-api-key": key } : {};
}
