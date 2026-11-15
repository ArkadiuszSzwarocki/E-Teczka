"use strict";
const net = require('node:net');
const normalize = value => String(value || '').replace(/^::ffff:/, '');
function createProxyGate(trustedProxyIp, publicOrigin) {
  const trusted = normalize(trustedProxyIp);
  if (!net.isIP(trusted)) throw new Error('A concrete trusted proxy IP is required.');
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('A public HTTPS origin is required.');
  return (req, res, next) => {
    const peer = normalize(req.socket.remoteAddress), client = req.get('x-real-ip');
    if (peer !== trusted || typeof client !== 'string' || !net.isIP(client) || req.get('x-forwarded-proto') !== 'https' || req.get('host') !== origin.host) return res.status(403).json({ error: 'Dostęp niedozwolony.' });
    res.locals.verifiedClientIp = normalize(client);
    next();
  };
}
module.exports = { createProxyGate };
