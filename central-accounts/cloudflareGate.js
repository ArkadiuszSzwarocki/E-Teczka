'use strict';
const net = require('node:net');
const normalize = value => String(value || '').replace(/^::ffff:/, '');

// Only use this with a dedicated network where untrusted peers cannot assume
// the connector's IP. A changed IP fails closed until configuration is updated.
function createCloudflareGate(trustedConnectorIp) {
  const trusted = normalize(trustedConnectorIp);
  if (!net.isIP(trusted)) throw new Error('A concrete cloudflared connector IP is required.');
  return (req, res, next) => {
    const peer = normalize(req.socket.remoteAddress);
    const client = req.get('cf-connecting-ip');
    if (peer !== trusted || typeof client !== 'string' || !net.isIP(client)) return res.status(403).json({ error: 'Dostęp niedozwolony.' });
    res.locals.verifiedClientIp = client;
    return next();
  };
}
module.exports = { createCloudflareGate };
