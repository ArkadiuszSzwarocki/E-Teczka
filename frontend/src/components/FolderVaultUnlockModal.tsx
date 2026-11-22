import { useState } from 'react';
import { getElectronIpc, isAccessResult } from '../services/electron';
import { completeVaultRecovery, ensureDifferentFromAppAccess, requestVaultRecovery, unlockVault, type VaultLoginMethod } from '../services/folderVaultApi';
import { FolderIconView, VAULT_ICON_ID } from './FolderIconPicker';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  folderId: number;
  folderName: string;
  loginMethod: VaultLoginMethod;
  onUnlocked: () => void;
  onCancel: () => void;
};

/** Unlock dialog for Safe Vault folders + email recovery gated by Authenticator. */
export default function FolderVaultUnlockModal({ apiUrl, fetcher, folderId, folderName, loginMethod, onUnlocked, onCancel }: Props) {
  const [secret, setSecret] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const [biometricVerified, setBiometricVerified] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [recoveryTotp, setRecoveryTotp] = useState('');
  const [emailSentTo, setEmailSentTo] = useState('');
  const [emailCode, setEmailCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPin, setNewPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  const verifyBio = async () => {
    setError('');
    const ipc = getElectronIpc();
    if (!ipc) { setError('Biometria Windows Hello działa w aplikacji desktopowej.'); return; }
    const res = await ipc.invoke('mojateczka-hello-verify');
    if (isAccessResult(res) && res.ok) setBiometricVerified(true);
    else setError((isAccessResult(res) && res.error) || 'Nie udało się potwierdzić biometrii.');
  };

  const handleUnlock = async () => {
    setError(''); setInfo('');
    setBusy(true);
    try {
      await unlockVault(apiUrl, fetcher, folderId, {
        secret: loginMethod === 'biometric_totp' ? undefined : secret,
        biometricVerified,
        totpCode: totpCode.trim(),
      });
      onUnlocked();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się otworzyć sejfu.');
    } finally {
      setBusy(false);
    }
  };

  const handleSendRecoveryEmail = async () => {
    setError(''); setInfo(''); setBusy(true);
    try {
      const res = await requestVaultRecovery(apiUrl, fetcher, folderId, recoveryTotp.trim());
      setEmailSentTo(res.sentTo);
      setInfo(`Wysłano kod odzyskiwania na ${res.sentTo}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd wysyłania kodu.');
    } finally {
      setBusy(false);
    }
  };

  const handleCompleteRecovery = async () => {
    setError(''); setInfo(''); setBusy(true);
    try {
      const appCollision = await ensureDifferentFromAppAccess(newPassword, newPin);
      if (appCollision) { setError(appCollision); setBusy(false); return; }
      await completeVaultRecovery(apiUrl, fetcher, folderId, {
        emailCode: emailCode.trim(),
        totpCode: recoveryTotp.trim(),
        newPassword,
        newPin,
      });
      setInfo('Ustawiono nowe hasło i PIN sejfu. Możesz teraz otworzyć kartotekę.');
      setRecoveryOpen(false); setEmailSentTo(''); setEmailCode(''); setNewPassword(''); setNewPin('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zmienić hasła i PIN-u.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[170] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-red-500/50 bg-[#0f172a] shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <div className="flex items-center gap-3">
            <FolderIconView icon={VAULT_ICON_ID} size="md" />
            <div>
              <h2 className="text-lg font-bold text-white">{folderName}</h2>
              <p className="text-xs text-red-300">Sejf pod specjalnym nadzorem</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} className="rounded-lg px-2 py-1 text-2xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </header>
        <div className="space-y-4 overflow-y-auto p-6 text-sm text-slate-200">
          {loginMethod === 'biometric_totp' ? (
            <button type="button" onClick={() => void verifyBio()} className={`w-full rounded-xl py-2.5 text-sm font-bold ${biometricVerified ? 'bg-emerald-600 text-white' : 'border border-blue-400 text-blue-200 hover:bg-blue-500/10'}`}>
              {biometricVerified ? '✓ Biometria potwierdzona' : 'Potwierdź biometrię (Windows Hello)'}
            </button>
          ) : (
            <div>
              <label className="mb-1 block text-xs font-bold text-slate-300">{loginMethod === 'pin_totp' ? 'Kod PIN do sejfu' : 'Hasło do sejfu'}</label>
              <input type="password" inputMode={loginMethod === 'pin_totp' ? 'numeric' : 'text'} value={secret} onChange={e => setSecret(e.target.value)} className="w-full rounded-lg border border-slate-600 bg-[#111827] px-3 py-2 text-white" />
            </div>
          )}

          <div>
            <label className="mb-1 block text-xs font-bold text-slate-300">Kod z Microsoft Authenticator</label>
            <input inputMode="numeric" maxLength={6} value={totpCode} onChange={e => setTotpCode(e.target.value)} onKeyDown={e => e.key === 'Enter' && void handleUnlock()} placeholder="6 cyfr" className="w-full rounded-lg border border-slate-600 bg-[#111827] px-3 py-2 text-white" />
          </div>

          <button type="button" disabled={busy} onClick={() => void handleUnlock()} className="w-full rounded-xl bg-blue-600 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50">
            {busy ? 'Sprawdzanie…' : 'Otwórz sejf'}
          </button>

          <div className="border-t border-slate-700 pt-3">
            <button type="button" onClick={() => setRecoveryOpen(v => !v)} className="text-xs font-semibold text-sky-300 hover:underline">
              🔑 Odzyskaj hasło / PIN na e-mail (wymaga Authenticatora)
            </button>
            {recoveryOpen && (
              <div className="mt-3 space-y-2.5 rounded-xl border border-slate-700 bg-[#111827]/70 p-3 text-xs">
                {!emailSentTo ? (
                  <>
                    <input inputMode="numeric" maxLength={6} value={recoveryTotp} onChange={e => setRecoveryTotp(e.target.value)} placeholder="Aktualny 6-cyfrowy kod z Authenticatora" className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-white" />
                    <button type="button" disabled={busy} onClick={() => void handleSendRecoveryEmail()} className="w-full rounded-lg border border-sky-400/60 bg-sky-600/20 py-2 font-bold text-sky-200 hover:bg-sky-600/30">
                      Wyślij kod na e-mail
                    </button>
                  </>
                ) : (
                  <>
                    <p className="text-emerald-300 font-semibold">✓ Authenticator potwierdzony. Kod wysłano na {emailSentTo}.</p>
                    <input value={emailCode} onChange={e => setEmailCode(e.target.value)} placeholder="8-cyfrowy kod z wiadomości e-mail" className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-white" />
                    <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Nowe hasło sejfu (min. 8 znaków)" className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-white" />
                    <input type="password" inputMode="numeric" value={newPin} onChange={e => setNewPin(e.target.value)} placeholder="Nowy PIN sejfu (6–12 cyfr)" className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-white" />
                    <button type="button" disabled={busy} onClick={() => void handleCompleteRecovery()} className="w-full rounded-lg bg-emerald-600 py-2 font-bold text-white hover:bg-emerald-500">
                      Zapisz nowe hasło i PIN
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          {info && <p role="status" className="rounded-lg border border-emerald-500/60 bg-emerald-950/40 p-2.5 text-xs text-emerald-200">{info}</p>}
          {error && <p role="alert" className="rounded-lg border border-red-500/60 bg-red-950/40 p-2.5 text-xs text-red-200">{error}</p>}
        </div>
      </section>
    </div>
  );
}
