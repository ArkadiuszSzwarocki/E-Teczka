import CryptoJS from 'crypto-js';

/** QR is read from the computer screen; compare its fingerprint with the downloaded CA. */
export function verifyCertificate(pem: string, fingerprint: string) {
  const normalized = fingerprint.replace(/:/g, '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized) || pem.length > 16384) throw new Error('Nieprawidłowy odcisk certyfikatu w kodzie QR.');
  const match = /^\s*-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\r\n]+)\s*-----END CERTIFICATE-----\s*$/.exec(pem);
  if (!match) throw new Error('Komputer zwrócił nieprawidłowy certyfikat.');
  const actual = CryptoJS.SHA256(CryptoJS.enc.Base64.parse(match[1].replace(/\s/g, ''))).toString();
  if (actual !== normalized) throw new Error('Odcisk certyfikatu nie zgadza się z kodem QR. Nie instaluj go.');
  return pem;
}
