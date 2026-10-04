import type { AuthenticatedUser } from '@canal-direto/shared';

const TOKEN_KEY = 'token';
const USER_KEY = 'user';

export function saveSession(token: string, user: AuthenticatedUser) {
  window.localStorage.setItem(TOKEN_KEY, token);
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function updateCurrentUser(user: AuthenticatedUser) {
  if (typeof window !== 'undefined') window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getCurrentUser(): AuthenticatedUser | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function clearSession() {
  window.localStorage.removeItem(TOKEN_KEY);
  window.localStorage.removeItem(USER_KEY);
}
