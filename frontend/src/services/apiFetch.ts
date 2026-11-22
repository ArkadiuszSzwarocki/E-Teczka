/** Creates a fetch wrapper that injects the auth token, clears expired sessions, and emits plan-limit events. */
export function createApiFetch(apiUrl: string): typeof fetch {
  return async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const requestUrl = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url,
      window.location.href,
    );
    const apiOrigin = new URL(apiUrl).origin;
    const token = localStorage.getItem('eteczka_auth_token');
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined));
    if (token && requestUrl.origin === apiOrigin) headers.set('Authorization', `Bearer ${token}`);
    const response = await window.fetch(input, { ...init, headers });
    const isSecondaryVerify = requestUrl.pathname.startsWith('/api/account-security/');
    if (token && localStorage.getItem('eteczka_auth_token') === token && response.status === 401 && requestUrl.origin === apiOrigin && !isSecondaryVerify) {
      localStorage.removeItem('eteczka_auth_token');
      window.dispatchEvent(new Event('eteczka-auth-changed'));
    }
    const method = (init.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (requestUrl.origin === apiOrigin && response.status === 403) {
      const data = await response.clone().json().catch(() => ({})) as { code?: string; error?: string; resetsAt?: string };
      if (data.code === 'DEVICE_REVOKED') {
        if (token && localStorage.getItem('eteczka_auth_token') === token) {
          localStorage.removeItem('eteczka_auth_token');
        }
        window.dispatchEvent(new CustomEvent('eteczka-device-revoked', {
          detail: 'To urządzenie zostało usunięte z konta i zostało automatycznie wylogowane.',
        }));
        return response;
      }
      if ((method !== 'GET' || /\/api\/backup\/oauth\/[^/]+\/start$/.test(requestUrl.pathname))
        && ['PLAN_LIMIT_REACHED', 'OCR_UNAVAILABLE', 'PREMIUM_REQUIRED', 'DEVICE_LIMIT_REACHED'].includes(data.code || '')) {
        const renewal = data.resetsAt ? ` Najbliższe zwolnienie limitu: ${new Date(data.resetsAt).toLocaleString('pl-PL')}.` : '';
        window.dispatchEvent(new CustomEvent('eteczka-plan-limit', { detail: (data.error || 'Limit Twojego planu został wykorzystany.') + renewal }));
      }
    } else if (
      requestUrl.origin === apiOrigin
      && (method !== 'GET' || /\/api\/backup\/oauth\/[^/]+\/start$/.test(requestUrl.pathname))
      && response.status === 402
    ) {
      const data = await response.clone().json().catch(() => ({})) as { code?: string; error?: string; resetsAt?: string };
      if (['PLAN_LIMIT_REACHED', 'OCR_UNAVAILABLE', 'PREMIUM_REQUIRED', 'DEVICE_LIMIT_REACHED'].includes(data.code || '')) {
        const renewal = data.resetsAt ? ` Najbliższe zwolnienie limitu: ${new Date(data.resetsAt).toLocaleString('pl-PL')}.` : '';
        window.dispatchEvent(new CustomEvent('eteczka-plan-limit', { detail: (data.error || 'Limit Twojego planu został wykorzystany.') + renewal }));
      }
    }
    return response;
  };
}
