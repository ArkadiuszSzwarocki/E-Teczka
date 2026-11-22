"use strict";
const net = require('node:net');
const normalize = value => String(value || '').replace(/^::ffff:/, '');
function createProxyGate(trustedProxyIp, publicOrigin) {
  const trusted = normalize(trustedProxyIp);
  if (!net.isIP(trusted)) throw new Error('A concrete trusted proxy IP is required.');
  const origin = new URL(publicOrigin);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('A public HTTPS origin is required.');
  return (req, res, next) => {
    const peer = normalize(req.socket.remoteAddress);
    const rawForwarded = String(req.get('x-forwarded-for') || '').split(',')[0].trim();
    const client = normalize(req.get('x-real-ip') || rawForwarded);
    const proto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim().toLowerCase();
    const host = String(req.get('host') || '').trim().toLowerCase();
    if (peer !== trusted || !net.isIP(client) || proto !== 'https' || host !== origin.host.toLowerCase()) return res.status(403).json({ error: 'Dostęp niedozwolony.' });
    res.locals.verifiedClientIp = client;
    next();
  };
}
module.exports = { createProxyGate };
