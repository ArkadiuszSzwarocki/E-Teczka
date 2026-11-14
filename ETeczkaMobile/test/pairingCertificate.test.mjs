import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyCertificate } from '../src/services/pairingCertificate.ts';

test('only a certificate matching the fingerprint from the QR is accepted', () => {
  const pem = '-----BEGIN CERTIFICATE-----\nAQID\n-----END CERTIFICATE-----\n';
  const fingerprint = createHash('sha256').update(Buffer.from([1, 2, 3])).digest('hex').match(/../g).join(':').toUpperCase();
  assert.equal(verifyCertificate(pem, fingerprint), pem);
  assert.throws(() => verifyCertificate(pem.replace('AQID', 'AQIE'), fingerprint), /nie zgadza/);
  assert.throws(() => verifyCertificate(pem, 'wrong'), /Nieprawidłowy/);
  assert.throws(() => verifyCertificate(`${pem}${pem}`, fingerprint), /nieprawidłowy certyfikat/i);
});
