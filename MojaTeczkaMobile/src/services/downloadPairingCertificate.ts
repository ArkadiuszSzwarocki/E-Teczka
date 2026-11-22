import { fetchWithTimeout } from './networkRequest';
import { normalizeServerUrl } from './localConnection';
import { verifyCertificate } from './pairingCertificate';

export async function fetchVerifiedPairingCertificate(serverUrl: string, fingerprint: string) {
  const url = new URL(normalizeServerUrl(serverUrl));
  if (url.protocol !== 'https:') throw new Error('Kod QR musi zawierać adres HTTPS komputera.');
  // Only the public CA certificate is downloaded over HTTP. No pairing code,
  // token, document, or user data is sent before TLS is established.
  const response = await fetchWithTimeout(`http://${url.hostname}:3000/api/pairing-certificate`, { redirect: 'error' }, 8000, 'Pobieranie certyfikatu');
  if (!response.ok) throw new Error('Nie udało się pobrać certyfikatu z komputera.');
  return verifyCertificate(await response.text(), fingerprint);
}
