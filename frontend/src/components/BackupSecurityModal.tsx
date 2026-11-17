import { useEffect, useRef, useState } from 'react';
import BackupAuthenticatorSetup from './BackupAuthenticatorSetup';
import BackupRecoveryKey from './BackupRecoveryKey';
import BackupAuthenticatorDialog from './BackupAuthenticatorDialog';

type Props = {
  embedded?: boolean;
  apiUrl: string;
  fetcher: typeof fetch;
  onClose: () => void;
};

/** Backup MFA and recovery key configuration opened from App Settings. */
export default function BackupSecurityModal({ embedded = false, apiUrl, fetcher: fetch, onClose }: Props) {
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [mfaPromptOpen, setMfaPromptOpen] = useState(false);
  const [error, setError] = useState('');
  const pendingMfa = useRef<{ resolve: (code: string) => void; reject: (err: Error) => void } | null>(null);

  const authHeaders = (): Record<string, string> => {
    const token = localStorage.getItem('eteczka_auth_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  useEffect(() => () => {
    pendingMfa.current?.reject(new Error('Anulowano potwierdzanie operacji.'));
    pendingMfa.current = null;
  }, []);

  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/api/backup/authenticator/status`, { headers: authHeaders() })
      .then(async (res) => {
        if (!res.ok) throw new Error('Nie można sprawdzić zabezpieczeń kopii.');
        return res.json();
      })
      .then((result) => { if (active) setMfaEnabled(Boolean(result.enabled)); })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : 'Błąd połączenia.'); });
    return () => { active = false; };
  }, [apiUrl, fetch]);

  const askForMfa = () => new Promise<string>((resolve, reject) => {
    if (pendingMfa.current) { reject(new Error('Inna operacja oczekuje na potwierdzenie.')); return; }
    pendingMfa.current = { resolve, reject };
    setMfaPromptOpen(true);
  });

  const authorize = async (action: string, suppliedCode?: string): Promise<Record<string, string>> => {
    if (mfaEnabled === null) throw new Error('Nie można sprawdzić zabezpieczeń kopii.');
    if (!mfaEnabled) return authHeaders();
    const code = suppliedCode === undefined ? await askForMfa() : suppliedCode;
    if (!code.trim()) throw new Error('Wpisz kod z Microsoft Authenticator.');
    const response = await fetch(`${apiUrl}/api/backup/authenticator/authorize`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, code: code.trim() }),
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || 'Nieprawidłowy kod Authenticatora.');
    return { ...authHeaders(), 'x-backup-authorization': payload.token };
  };

  return (
    <div className={embedded ? 'w-full' : 'fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm'}>
      <section role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : 'true'} className={embedded ? 'flex w-full flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0f172a] shadow-xl' : 'flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-600 bg-[#0f172a] shadow-2xl'}>
        <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <div>
            <h2 className="text-xl font-bold text-white">🛡️ Zabezpieczenia kopii zapasowej</h2>
            <p className="mt-1 text-xs text-slate-400">Weryfikacja dwuetapowa Microsoft Authenticator oraz klucz odzyskiwania zaszyfrowanych kopii.</p>
          </div>
          <button type="button" aria-label="Zamknij" onClick={onClose} className="rounded-lg px-2 py-1 text-2xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </header>
        <div className="grid grid-cols-1 gap-5 overflow-y-auto p-6 md:grid-cols-2">
          <div className="rounded-xl border border-slate-700/80 bg-[#111827]/70 p-5">
            <h3 className="mb-2 text-sm font-bold text-white">Weryfikacja dwuetapowa (MFA)</h3>
            <BackupAuthenticatorSetup apiUrl={apiUrl} headers={authHeaders} enabled={mfaEnabled} onChange={setMfaEnabled} />
          </div>
          <div className="rounded-xl border border-slate-700/80 bg-[#111827]/70 p-5">
            <h3 className="mb-2 text-sm font-bold text-white">Szyfrowanie i klucz odzyskiwania</h3>
            <BackupRecoveryKey apiUrl={apiUrl} mode="settings" authorize={authorize} disabled={false} onRecovery={() => {}} />
          </div>
          {error && <p role="status" className="md:col-span-2 rounded-lg border border-red-700/60 bg-red-950/30 p-3 text-sm text-red-200">{error}</p>}
        </div>
      </section>
      {mfaPromptOpen && (
        <BackupAuthenticatorDialog
          onCancel={() => {
            const pending = pendingMfa.current;
            pendingMfa.current = null;
            setMfaPromptOpen(false);
            pending?.reject(new Error('Anulowano potwierdzanie operacji.'));
          }}
          onSubmit={(code) => {
            const pending = pendingMfa.current;
            pendingMfa.current = null;
            setMfaPromptOpen(false);
            pending?.resolve(code);
          }}
        />
      )}
    </div>
  );
}
