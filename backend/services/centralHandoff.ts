import crypto from 'node:crypto';
import { centralAccountOrigin, verifyCentralSession } from './centralAccountLink';

type Handoff = { origin: string; requestId: string; verifier: string; expiresAt: number; busy: boolean; centralToken?: string; user?: { id: string; email: string; name: string | null } };

export function createCentralHandoffs(request: typeof fetch = fetch) {
  const pending = new Map<string, Handoff>();
  const clearExpired = () => { const now = Date.now(); for (const [key, item] of pending) if (item.expiresAt <= now && !item.busy) pending.delete(key); };
  async function post(origin: string, path: string, data: object) {
    const response = await request(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data), redirect: 'error', signal: AbortSignal.timeout(10000) });
    const result = await response.json() as Record<string, unknown>;
    return { response, result };
  }
  return {
    async start(configuredOrigin: string) {
      const origin = centralAccountOrigin(configuredOrigin); if (!origin) throw new Error('INVALID_ORIGIN');
      clearExpired(); if (pending.size >= 64) throw new Error('TOO_MANY_REQUESTS');
      const verifier = crypto.randomBytes(32).toString('base64url');
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const { response, result } = await post(origin, '/handoff/start', { challenge, deviceName: 'E-Teczka na komputerze' });
      if (!response.ok || typeof result.requestId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.requestId) || typeof result.displayCode !== 'string' || !/^\d{6}$/.test(result.displayCode) || typeof result.expiresAt !== 'number' || result.expiresAt <= Date.now() || result.expiresAt > Date.now() + 310000) throw new Error('INVALID_RESPONSE');
      const handle = crypto.randomBytes(32).toString('base64url');
      pending.set(handle, { origin, requestId: result.requestId, verifier, expiresAt: result.expiresAt, busy: false });
      return { handle, displayCode: result.displayCode, expiresAt: result.expiresAt, url: `${origin}/account#${result.requestId}` };
    },
    async poll(handle: string) {
      clearExpired(); const item = pending.get(handle); if (!item || item.expiresAt <= Date.now()) throw new Error('EXPIRED');
      if (item.user && item.centralToken) return { status: 'approved' as const, user: item.user };
      if (item.busy) return { status: 'pending' as const };
      item.busy = true;
      try {
        if (!item.centralToken) {
          const { response, result } = await post(item.origin, '/handoff/claim', { requestId: item.requestId, verifier: item.verifier });
          if (response.status === 202) return { status: 'pending' as const };
          if (!response.ok || typeof result.token !== 'string') throw new Error('INVALID_RESPONSE');
          item.centralToken = result.token;
        }
        item.user = await verifyCentralSession(item.origin, item.centralToken, request);
        return { status: 'approved' as const, user: item.user };
      } finally { item.busy = false; }
    },
    async take(handle: string) {
      clearExpired(); const item = pending.get(handle);
      if (!item || item.expiresAt <= Date.now() || !item.centralToken || !item.user) throw new Error('EXPIRED');
      const user = await verifyCentralSession(item.origin, item.centralToken, request);
      if (user.id !== item.user.id) throw new Error('INVALID_SESSION');
      return { origin: item.origin, user, centralToken: item.centralToken };
    },
    finish(handle: string) { pending.delete(handle); }
  };
}
