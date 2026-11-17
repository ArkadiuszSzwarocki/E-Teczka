import { useEffect, useState } from 'react';
import { errorMessage } from '../utils/errors';

/** Polls local pairing code, paired devices, and HTTPS CA/network info for QR pairing. */
export function usePairingStatus(apiUrl: string, fetcher: typeof fetch) {
  const [pairingCode, setPairingCode] = useState('');
  const [localAddresses, setLocalAddresses] = useState<string[]>([]);
  const [localCaFingerprint, setLocalCaFingerprint] = useState('');
  const [pairedPhones, setPairedPhones] = useState<{ id: string; name: string }[]>([]);
  const [pairingLimit, setPairingLimit] = useState<number | null>(null);
  const [replacementBusy, setReplacementBusy] = useState(false);
  const [replacementNotice, setReplacementNotice] = useState('');
  const [phoneConnected, setPhoneConnected] = useState(false);
  const [isPairingGuideOpen, setIsPairingGuideOpen] = useState(false);

  const replacePhone = async (deviceId: string) => {
    setReplacementBusy(true);
    setReplacementNotice('');
    try {
      const response = await fetcher(`${apiUrl}/api/pairing-replacement`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Nie udało się przygotować parowania.');
      setPairingCode(data.code);
      setReplacementNotice(`Zeskanuj nowy kod QR na telefonie. Poprzednie parowanie „${data.replaces}” zostanie odłączone dopiero po udanym połączeniu.`);
    } catch (error) {
      setReplacementNotice(errorMessage(error, 'Nie udało się przygotować parowania.'));
    } finally {
      setReplacementBusy(false);
    }
  };

  useEffect(() => {
    const fetchPairingCode = async () => {
      try {
        const response = await fetcher(`${apiUrl}/api/pairing-code`);
        const data = await response.json();
        setPairingCode(data.code || '');
      } catch {
        setPairingCode('');
      }
    };
    const fetchPairingStatus = async () => {
      try {
        const response = await fetcher(`${apiUrl}/api/pairing-status`);
        const data = await response.json();
        setPhoneConnected(Boolean(data.phoneConnected));
        setPairedPhones(Array.isArray(data.devices) ? data.devices : []);
        setPairingLimit(data.mobileDeviceLimit ?? null);
      } catch {
        setPhoneConnected(false);
      }
    };
    void fetchPairingCode();
    void fetchPairingStatus();
    const interval = setInterval(() => void fetchPairingCode(), 30000);
    const statusInterval = setInterval(() => void fetchPairingStatus(), 5000);
    return () => { clearInterval(interval); clearInterval(statusInterval); };
  }, [apiUrl, fetcher]);

  useEffect(() => {
    const fetchNetworkInfo = async () => {
      try {
        const result = await fetcher(`${apiUrl}/api/local-ca-info`);
        const info = await result.json();
        if (result.ok && typeof info.fingerprint === 'string') setLocalCaFingerprint(info.fingerprint);
      } catch {
        setLocalCaFingerprint('');
      }
      try {
        const response = await fetcher(`${apiUrl}/api/network-info`);
        const data = await response.json();
        const port = data.port || 3443;
        setLocalAddresses((data.addresses || []).map((address: string) => `${address}:${port}`));
      } catch {
        setLocalAddresses([]);
      }
    };
    void fetchNetworkInfo();
    const interval = setInterval(() => void fetchNetworkInfo(), 30000);
    return () => clearInterval(interval);
  }, [apiUrl, fetcher]);

  return {
    pairingCode,
    localAddresses,
    localCaFingerprint,
    pairedPhones,
    pairingLimit,
    replacementBusy,
    replacementNotice,
    phoneConnected,
    isPairingGuideOpen,
    setIsPairingGuideOpen,
    replacePhone,
  };
}
