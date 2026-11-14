import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import forge from 'node-forge';

function keyPair() {
  const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } });
  return { privateKey: forge.pki.privateKeyFromPem(pair.privateKey), publicKey: forge.pki.publicKeyFromPem(pair.publicKey), privatePem: pair.privateKey };
}
function serial() { return `01${crypto.randomBytes(15).toString('hex')}`; }
function addresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat().filter((entry): entry is os.NetworkInterfaceInfo => Boolean(entry && entry.family === 'IPv4')).map(entry => entry.address))];
}
export function makeLocalTls(directory: string, ips = addresses()) {
  fs.mkdirSync(directory, { recursive: true });
  const keyFile = path.join(directory, 'local-ca-key.pem'); const certFile = path.join(directory, 'local-ca-cert.pem');
  let caKey: forge.pki.PrivateKey; let ca: forge.pki.Certificate;
  if (fs.existsSync(keyFile) || fs.existsSync(certFile)) {
    if (!fs.existsSync(keyFile) || !fs.existsSync(certFile)) throw new Error('Niekompletny certyfikat lokalnego urzędu E-Teczki.');
    caKey = forge.pki.privateKeyFromPem(fs.readFileSync(keyFile, 'utf8')); ca = forge.pki.certificateFromPem(fs.readFileSync(certFile, 'utf8'));
    if (!ca.verify(ca) || ca.validity.notAfter.getTime() <= Date.now() || !ca.publicKey || !('n' in ca.publicKey) || !('n' in caKey) || !ca.publicKey.n.equals(caKey.n)) throw new Error('Certyfikat lokalnego urzędu jest nieprawidłowy lub wygasł.');
  } else {
    const pair = keyPair(); caKey = pair.privateKey; ca = forge.pki.createCertificate(); ca.publicKey = pair.publicKey; ca.serialNumber = serial(); ca.validity.notBefore = new Date(Date.now() - 86400000); ca.validity.notAfter = new Date(Date.now() + 3650 * 86400000);
    ca.setSubject([{ name: 'commonName', value: 'E-Teczka lokalny urzad certyfikacji' }]); ca.setIssuer(ca.subject.attributes); ca.setExtensions([{ name: 'basicConstraints', cA: true, critical: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true }, { name: 'subjectKeyIdentifier' }]); ca.sign(caKey, forge.md.sha256.create());
    fs.writeFileSync(keyFile, pair.privatePem, { mode: 0o600, flag: 'wx' });
    try { fs.writeFileSync(certFile, forge.pki.certificateToPem(ca), { mode: 0o600, flag: 'wx' }); } catch (e) { fs.unlinkSync(keyFile); throw e; }
  }
  const leafKeys = keyPair(); const leaf = forge.pki.createCertificate(); leaf.publicKey = leafKeys.publicKey; leaf.serialNumber = serial(); leaf.validity.notBefore = new Date(Date.now() - 86400000); leaf.validity.notAfter = new Date(Math.min(Date.now() + 365 * 86400000, ca.validity.notAfter.getTime()));
  leaf.setSubject([{ name: 'commonName', value: 'E-Teczka lokalny serwer' }]); leaf.setIssuer(ca.subject.attributes);
  leaf.setExtensions([{ name: 'basicConstraints', cA: false, critical: true }, { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true }, { name: 'extKeyUsage', serverAuth: true }, { name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...[...new Set(['127.0.0.1', ...ips])].map(ip => ({ type: 7, ip }))] }]);
  leaf.sign(caKey, forge.md.sha256.create());
  const caPem = forge.pki.certificateToPem(ca);
  return { key: leafKeys.privatePem, cert: forge.pki.certificateToPem(leaf), caPem, fingerprint: new crypto.X509Certificate(caPem).fingerprint256 };
}
