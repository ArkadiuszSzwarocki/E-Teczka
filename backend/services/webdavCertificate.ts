import dns from 'node:dns/promises';
import { isIP } from 'node:net';
import tls from 'node:tls';

// Probe only the certificate, without sending credentials. A suggested hostname
// must resolve to the entered IP and pass normal certificate validation.
export async function suggestNasHostname(endpoint: string): Promise<string | null> {
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  if (url.protocol !== 'https:' || isIP(url.hostname) !== 4) return null;
  const ip = url.hostname; const port = Number(url.port || 443);
  const names = await new Promise<string[]>(resolve => {
    const socket = tls.connect({ host: ip, port, rejectUnauthorized: false, timeout: 3000 }, () => {
      const san = socket.getPeerCertificate().subjectaltname || '';
      socket.destroy();
      resolve(san.split(', ').filter(name => name.startsWith('DNS:')).map(name => name.slice(4)).filter(name => !name.includes('*')).slice(0, 10));
    });
    socket.on('error', () => resolve([])); socket.on('timeout', () => { socket.destroy(); resolve([]); });
  });
  for (const name of names) {
    const addresses = await dns.lookup(name, { all: true }).catch(() => []);
    if (!addresses.some(address => address.address === ip)) continue;
    const verified = await new Promise<boolean>(resolve => {
      const socket = tls.connect({ host: ip, port, servername: name, rejectUnauthorized: true, timeout: 3000 }, () => { socket.destroy(); resolve(true); });
      socket.on('error', () => resolve(false)); socket.on('timeout', () => { socket.destroy(); resolve(false); });
    });
    if (verified) { url.hostname = name; return url.toString().replace(/\/$/, ''); }
  }
  return null;
}
