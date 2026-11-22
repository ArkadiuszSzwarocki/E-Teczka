import { useEffect, useRef, useState } from 'react';

/** Manages backup MFA status check, interactive TOTP prompt, and authorization header acquisition. */
export function useBackupMfa(
  apiUrl: string,
  fetcher: typeof fetch,
  onError: (msg: string) => void,
) {
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [mfaPromptOpen, setMfaPromptOpen] = useState(false);
  const pendingMfa = useRef<{ resolve: (code: string) => void; reject: (error: Error) => void } | null>(null);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('mojateczka_auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => () => {
    pendingMfa.current?.reject(new Error('Anulowano potwierdzanie operacji.'));
    pendingMfa.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    fetcher(`${apiUrl}/api/backup/authenticator/status`, { headers: authHeaders() })
      .then(async response => {
        if (!response.ok) throw new Error('Nie można sprawdzić zabezpieczeń kopii.');
        return response.json();
      })
      .then(result => { if (active) setMfaEnabled(Boolean(result.enabled)); })
      .catch(error => { if (active) onError(error instanceof Error ? error.message : 'Nie można sprawdzić zabezpieczeń kopii.'); });
    return () => { active = false; };
  }, [apiUrl]);

  const askForMfa = () => new Promise<string>((resolve, reject) => {
    if (pendingMfa.current) { reject(new Error('Inna operacja oczekuje na potwierdzanie.')); return; }
    pendingMfa.current = { resolve, reject };
    setMfaPromptOpen(true);
  });

  const authorize = async (action: string, suppliedCode?: string): Promise<Record<string, string>> => {
    if (mfaEnabled === null) throw new Error('Nie można sprawdzić zabezpieczeń kopii.');
    if (!mfaEnabled) return authHeaders();
    const code = suppliedCode === undefined ? await askForMfa() : suppliedCode;
    if (!code.trim()) throw new Error('Wpisz kod z Microsoft Authenticator.');
    const response = await fetcher(`${apiUrl}/api/backup/authenticator/authorize`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, code: code.trim() }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Nieprawidłowy kod Authenticatora.');
    return { ...authHeaders(), 'x-backup-authorization': payload.token };
  };

  const cancelMfaPrompt = () => {
    const pending = pendingMfa.current;
    pendingMfa.current = null;
    setMfaPromptOpen(false);
    pending?.reject(new Error('Anulowano potwierdzanie operacji.'));
  };

  const submitMfaPrompt = (code: string) => {
    const pending = pendingMfa.current;
    pendingMfa.current = null;
    setMfaPromptOpen(false);
    pending?.resolve(code);
  };

  return { mfaEnabled, mfaPromptOpen, authHeaders, authorize, cancelMfaPrompt, submitMfaPrompt };
}
