"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSecureRemote = requireSecureRemote;
function requireSecureRemote(req, res, next) {
    const peer = req.socket.remoteAddress || '';
    const loopback = peer === '127.0.0.1' || peer === '::1' || peer === '::ffff:127.0.0.1';
    if (!loopback && !('encrypted' in req.socket && req.socket.encrypted === true))
        return res.status(426).json({ error: 'Połączenie wymaga HTTPS. Zaktualizuj aplikację i sparuj telefon ponownie.' });
    next();
}
