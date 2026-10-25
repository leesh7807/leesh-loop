const MANAGER_TOKEN_STORAGE_KEY = 'leesh-loop.manager.token.v1';
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;

export function bootstrapManagerToken(context = {}) {
  try {
    const location = context.location || window.location;
    const history = context.history || window.history;
    const storage = context.storage || window.sessionStorage;
    const fragment = new URLSearchParams(location.hash.startsWith('#') ? location.hash.slice(1) : location.hash);
    const token = fragment.get('manager-token');
    if (token && TOKEN_PATTERN.test(token)) {
      try { storage.setItem(MANAGER_TOKEN_STORAGE_KEY, token); } catch { /* Keep the token for this page load. */ }
      history.replaceState(history.state, '', `${location.pathname}${location.search}`);
      return token;
    }
    return storage.getItem(MANAGER_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}
