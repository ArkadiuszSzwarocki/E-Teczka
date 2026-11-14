import type { Request, Response, NextFunction } from 'express';
export function requireSecureRemote(req: Request, res: Response, next: NextFunction) {
  const peer = req.socket.remoteAddress || '';
  const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
  if (!loopback && !('encrypted' in req.socket && req.socket.encrypted === true)) return res.status(426).json({ error: 'Połączenie wymaga HTTPS. Zaktualizuj aplikację i sparuj telefon ponownie.' });
  next();
}
