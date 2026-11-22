import type { Request, Response, NextFunction } from 'express';

const trustedProxyIps = new Set(
  (process.env.ETECZKA_TRUSTED_PROXY_IPS || '')
    .split(',')
    .map(ip => ip.trim())
    .filter(Boolean),
);

export function requireSecureRemote(req: Request, res: Response, next: NextFunction) {
  const peer = req.socket.remoteAddress || '';
  const normalizedPeer = peer.startsWith('::ffff:') ? peer.slice(7) : peer;
  const loopback = normalizedPeer === '127.0.0.1' || normalizedPeer === '::1';
  const encrypted = 'encrypted' in req.socket && req.socket.encrypted === true;
  const trustedHttpsProxy =
    trustedProxyIps.has(normalizedPeer) &&
    String(req.header('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase() === 'https';
  if (!loopback && !encrypted && !trustedHttpsProxy) {
    return res.status(426).json({ error: 'Połączenie wymaga HTTPS. Zaktualizuj aplikację i sparuj telefon ponownie.' });
  }
  next();
}
