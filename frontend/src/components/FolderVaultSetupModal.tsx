import { useEffect, useState } from 'react';
import QRCode from 'react-qr-code';
import { getElectronIpc, isAccessResult } from '../services/electron';
import { confirmVaultSetup, ensureDifferentFromAppAccess, startVaultSetup, type VaultLoginMethod } from '../services/folderVaultApi';
import { FolderIconView, VAULT_ICON_ID } from './FolderIconPicker';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  folderId: number;
  folderName: string;
  accountEmail?: string;
  onConfigured: () => void;
  onCancel: () => void;
};

/** Configures Safe Vault protection (Password, PIN, Authenticator, Biometrics, Login Method, Recovery Email). */
export default function FolderVaultSetupModal({ apiUrl, fetcher, folderId, folderName, accountEmail, onConfigured, onCancel }: Props) {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState(accountEmail || '');
  const [loginMethod, setLoginMethod] = useState<VaultLoginMethod>('pin_totp');
  const [qrUri, setQrUri] = useState('');
  const [secret, setSecret] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [helloAvailable, setHelloAvailable] = useState(false);
  const [biometricVerified, setBiometricVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void startVaultSetup(apiUrl, fetcher, folderId)
      .then(res => { if (active) { setQrUri(res.uri); setSecret(res.secret); } })
      .catch(e => { if (active) setError(e instanceof Error ? e.message : 'Błąd konfiguracji sejfu.'); });
    const ipc = getElectronIpc();
    if (ipc) {
      void ipc.invoke('eteczka-hello-available')
        .then(res => {
          if (!active || !res || typeof res !== 'object') return;
          const payload = res as { available?: boolean; ok?: boolean };
          setHelloAvailable(Boolean(payload.available ?? payload.ok));
        })
        .catch(() => undefined);
    }
    return () => { active = false; };
  }, [apiUrl, fetcher, folderId]);

  const verifyBiometrics = async () => {
    setError('');
    const ipc = getElectronIpc();
    if (!ipc) { setError('Biometria Windows Hello działa w aplikacji desktopowej.'); return; }
    try {
      const res = await ipc.invoke('eteczka-hello-verify');
      if (isAccessResult(res) && res.ok) setBiometricVerified(true);
      else setError((isAccessResult(res) && res.error) || 'Nie udało się potwierdzić biometrii.');
    } catch {
      setError('Błąd weryfikacji Windows Hello.');
    }
  };

  const handleSubmit = async () => {
    setError('');
    if (password.length < 8) { setError('Nowe hasło do sejfu musi mieć co najmniej 8 znaków.'); return; }
    if (!/^\d{6,12}$/.test(pin)) { setError('Nowy kod PIN do sejfu musi mieć od 6 do 12 cyfr.'); return; }
    if (password === pin) { setError('Hasło i PIN do sejfu nie mogą być takie same.'); return; }
    if (helloAvailable && !biometricVerified) { setError('Potwierdź biometrię Windows Hello, aby włączyć nadzór sejfu.'); return; }
    if (!/^\d{6}$/.test(totpCode.trim())) { setError('Wpisz 6-cyfrowy kod z Microsoft Authenticator.'); return; }
    const effectiveRecoveryEmail = (accountEmail || recoveryEmail).trim();
    if (!effectiveRecoveryEmail.includes('@')) { setError('Podaj prawidłowy adres e-mail do odzyskiwania.'); return; }

    setBusy(true);
    try {
      const appCollision = await ensureDifferentFromAppAccess(password, pin);
      if (appCollision) { setError(appCollision); setBusy(false); return; }
      await confirmVaultSetup(apiUrl, fetcher, folderId, {
        password,
        pin,
        totpCode: totpCode.trim(),
        loginMethod,
        biometricEnabled: biometricVerified,
        recoveryEmail: effectiveRecoveryEmail,
      });
      onConfigured();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać sejfu.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-red-500/50 bg-[#0f172a] shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <FolderIconView icon={VAULT_ICON_ID} size="md" />
            <div>
              <h2 className="text-lg font-bold text-white">Kartoteka pod specjalnym nadzorem: {folderName}</h2>
              <p className="text-xs text-red-300">Nadaj osobne hasło, PIN, Microsoft Authenticator oraz biometrię (inne niż do aplikacji).</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-2xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </header>
        <div className="space-y-4 overflow-y-auto p-6 text-sm text-slate-200">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-300">Nowe hasło do sejfu (min. 8 znaków)</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Inne niż hasło do aplikacji" className="w-full rounded-lg border border-slate-600 bg-[#111827] px-3 py-2 text-white" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-300">Nowy kod PIN do sejfu (6–12 cyfr)</label>
              <input type="password" inputMode="numeric" value={pin} onChange={e => setPin(e.target.value)} placeholder="Inny niż PIN do aplikacji" className="w-full rounded-lg border border-slate-600 bg-[#111827] px-3 py-2 text-white" />
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-[#111827]/70 p-4 space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Microsoft Authenticator (wymagany zawsze)</p>
            <div className="flex flex-wrap items-center gap-4">
              {qrUri && <div className="rounded-lg bg-white p-2"><QRCode value={qrUri} size={112} /></div>}
              <div className="min-w-0 flex-1 space-y-2">
                <p className="text-xs text-slate-400">Zeskanuj kod QR w aplikacji Authenticator lub wpisz klucz: <code className="break-all text-sky-300">{secret}</code></p>
                <input inputMode="numeric" maxLength={6} value={totpCode} onChange={e => setTotpCode(e.target.value)} placeholder="6-cyfrowy kod z Authenticatora" className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-white" />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-[#111827]/70 p-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Biometria (Windows Hello)</p>
              <p className="text-xs text-slate-400">{helloAvailable ? 'Potwierdź tożsamość odciskiem palca lub twarzą.' : 'Windows Hello niedostępne na tym urządzeniu.'}</p>
            </div>
            {helloAvailable && (
              <button type="button" onClick={() => void verifyBiometrics()} className={`rounded-lg px-4 py-2 text-xs font-bold ${biometricVerified ? 'bg-emerald-600 text-white' : 'border border-blue-400 text-blue-200 hover:bg-blue-500/10'}`}>
                {biometricVerified ? '✓ Biometria potwierdzona' : 'Potwierdź biometrię'}
              </button>
            )}
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-300">Sposób otwierania sejfu (zawsze z Authenticatorem)</label>
              <select value={loginMethod} onChange={e => setLoginMethod(e.target.value as VaultLoginMethod)} className="w-full rounded-lg border border-slate-600 bg-[#111827] px-3 py-2 text-white">
                <option value="pin_totp">PIN + Authenticator</option>
                <option value="password_totp">Hasło + Authenticator</option>
                {helloAvailable && <option value="biometric_totp">Biometria + Authenticator</option>}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-300">E-mail do odzyskiwania hasła i PIN-u</label>
              {accountEmail ? (
                <div className="rounded-lg border border-slate-700 bg-[#111827] px-3 py-2 text-slate-300">{accountEmail}</div>
              ) : (
                <input type="email" value={recoveryEmail} onChange={e => setRecoveryEmail(e.target.value)} placeholder="twoj@email.pl" className="w-full rounded-lg border border-slate-600 bg-[#111827] px-3 py-2 text-white" />
              )}
            </div>
          </div>

          {error && <p role="alert" className="rounded-lg border border-red-500/60 bg-red-950/40 p-3 text-xs text-red-200">{error}</p>}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-700 px-6 py-4">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Anuluj</button>
          <button type="button" disabled={busy} onClick={() => void handleSubmit()} className="rounded-lg bg-red-600 px-5 py-2 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50">
            {busy ? 'Zapisywanie…' : 'Aktywuj nadzór sejfu'}
          </button>
        </footer>
      </section>
    </div>
  );
}
