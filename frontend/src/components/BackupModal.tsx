import { useEffect, useRef, useState } from 'react';
import WebDavFolderPicker from './WebDavFolderPicker';
import BackupRecoveryKey from './BackupRecoveryKey';
import BackupAuthenticatorSetup from './BackupAuthenticatorSetup';
import BackupActionDialog, { type BackupActionCredentials } from './BackupActionDialog';
import InfoTip from './InfoTip';
import BackupTransferAnimation from './BackupTransferAnimation';
import BackupAuthenticatorDialog from './BackupAuthenticatorDialog';
type Destination = 'computer' | 'cloud';
type Provider = 'webdav' | 'google-drive' | 'onedrive' | 'dropbox';
type Schedule = 'manual' | 'daily' | 'weekly';
export type BackupSection = 'settings' | 'send' | 'restore';
type Props = { fetcher: typeof fetch; apiUrl: string; section: BackupSection; onClose: () => void; onDone: () => void };

export default function BackupModal({ apiUrl, section, onClose, onDone, fetcher: fetch }: Props) {
  const [destination, setDestination] = useState<Destination>('computer'); const [provider, setProvider] = useState<Provider>('webdav'); const [endpoint, setEndpoint] = useState(''); const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [remoteFolder, setRemoteFolder] = useState(''); const [schedule, setSchedule] = useState<Schedule>('manual'); const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [nasType, setNasType] = useState<'qnap' | 'synology' | 'other'>('qnap');
  const [scheduleTime, setScheduleTime] = useState('02:15');
  const [actionDialog, setActionDialog] = useState<'send' | 'restore' | null>(null);
  const [mfaEnabled, setMfaEnabled] = useState<boolean | null>(null);
  const [mfaPromptOpen, setMfaPromptOpen] = useState(false);
  const pendingMfa = useRef<{ resolve: (code: string) => void; reject: (error: Error) => void } | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [backupUsername, setBackupUsername] = useState('');
  const [backupPassword, setBackupPassword] = useState('');
  const [backupCredentialSaved, setBackupCredentialSaved] = useState(false);
  const [recoveryFile, setRecoveryFile] = useState<File | null>(null);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [lastBackup, setLastBackup] = useState<{ at: string | null; status: string | null; error: string | null } | null>(null);
  const nasEndpoint = () => { const value = endpoint.trim(); if (!value || /^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return value; try { const url = new URL(`https://${value}`); if (!url.port && nasType !== 'other') url.port = nasType === 'qnap' ? '5001' : '5006'; return url.toString().replace(/\/$/, ''); } catch { return value; } };
  const authHeaders = (): Record<string, string> => { const token = localStorage.getItem('eteczka_auth_token'); return token ? { Authorization: `Bearer ${token}` } : {}; };
  useEffect(() => () => { pendingMfa.current?.reject(new Error('Anulowano potwierdzanie operacji.')); pendingMfa.current = null; }, []);
  const askForMfa = () => new Promise<string>((resolve, reject) => {
    if (pendingMfa.current) { reject(new Error('Inna operacja oczekuje na potwierdzenie.')); return; }
    pendingMfa.current = { resolve, reject }; setMfaPromptOpen(true);
  });
  useEffect(() => {
    let active = true;
    fetch(`${apiUrl}/api/backup/authenticator/status`, { headers: authHeaders() }).then(async response => { if (!response.ok) throw new Error('Nie można sprawdzić zabezpieczeń kopii.'); return response.json(); }).then(result => { if (active) setMfaEnabled(Boolean(result.enabled)); }).catch(error => { if (active) setMessage(error.message); });
    return () => { active = false; };
  }, [apiUrl]);
  const authorize = async (action: string, suppliedCode?: string): Promise<Record<string, string>> => {
    if (mfaEnabled === null) throw new Error('Nie można sprawdzić zabezpieczeń kopii.');
    if (!mfaEnabled) return authHeaders();
    const code = suppliedCode === undefined ? await askForMfa() : suppliedCode;
    if (!code.trim()) throw new Error('Wpisz kod z Microsoft Authenticator.');
    const response = await fetch(`${apiUrl}/api/backup/authenticator/authorize`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ action, code: code.trim() }) });
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || 'Nieprawidłowy kod Authenticatora.');
    return { ...authHeaders(), 'x-backup-authorization': payload.token };
  };
  useEffect(() => {
    let active = true;
    const token = localStorage.getItem('eteczka_auth_token');
    fetch(`${apiUrl}/api/backup/destination`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then(async response => { if (!response.ok) { if (response.status === 402) return null; throw new Error('Nie udało się wczytać ustawień kopii.'); } return response.json(); })
      .then(data => { if (!active || !data?.configured) return; setDestination('cloud'); setProvider(data.provider); setEndpoint(data.endpoint || ''); setBackupUsername(data.backupUsername || ''); setRemoteFolder(data.remoteFolder || ''); const [frequency, time] = String(data.schedule || 'manual').split('@'); setSchedule(frequency === 'daily' || frequency === 'weekly' ? frequency : 'manual'); setScheduleTime(time || '02:15'); setBackupCredentialSaved(Boolean(data.backupCredentialSaved)); setLastBackup({ at: data.lastBackupAt || null, status: data.lastBackupStatus || null, error: data.lastBackupError || null }); if (data.endpoint) { try { const port = new URL(data.endpoint).port; setNasType(port === '5001' ? 'qnap' : port === '5006' ? 'synology' : 'other'); } catch { setNasType('other'); } } })
      .catch(error => { if (active) setMessage(error instanceof Error ? error.message : 'Nie udało się wczytać ustawień kopii.'); })
      .finally(() => { if (active) setSettingsLoading(false); });
    return () => { active = false; };
  }, [apiUrl]);
  const restore = async (file: File, authorizedHeaders?: Record<string, string>) => { setBusy(true); setMessage('Przywracanie kopii…'); try { const protectedHeaders = authorizedHeaders || await authorize('restore'); const body = new FormData(); body.append('restoreMode', 'replace'); body.append('backup', file); if (recoveryFile) { if (recoveryFile.size > 4096) throw new Error('Plik klucza odzyskiwania jest nieprawidłowy.'); body.append('recoveryKey', await recoveryFile.text()); body.append('recoveryPassphrase', recoveryPassword); } const response = await fetch(`${apiUrl}/api/backup/restore`, { method: 'POST', headers: protectedHeaders, body }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Nie udało się przywrócić kopii.'); setMessage(`Przywrócono ${payload.restoredDocuments || 0} dokumentów.`); onDone(); } catch (error) { setMessage(error instanceof Error ? error.message : 'Błąd przywracania kopii.'); } finally { setBusy(false); } };
  const restoreLatestCloud = async (credentials: BackupActionCredentials) => { setBusy(true); setMessage('Pobieranie najnowszej kopii…'); try { const protectedHeaders = await authorize('cloudRestore', credentials.code); const response = await fetch(`${apiUrl}/api/backup/cloud/latest`, { method: 'POST', headers: { ...protectedHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: credentials.username, password: credentials.password }) }); const payload = response.ok ? null : await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload?.error || 'Nie udało się pobrać kopii z chmury.'); const disposition = response.headers.get('Content-Disposition') || ''; const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'eteczka-cloud-backup.zip.enc'; await restore(new File([await response.blob()], filename, { type: 'application/octet-stream' }), protectedHeaders); } catch (error) { setBusy(false); setMessage(error instanceof Error ? error.message : 'Błąd pobierania kopii z chmury.'); } };
  const exportBackup = async () => { setBusy(true); setMessage('Tworzenie kopii…'); try { const response = await fetch(`${apiUrl}/api/backup/export`, { headers: await authorize('export') }); if (!response.ok) throw new Error('Nie udało się utworzyć kopii.'); const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `eteczka-backup-${new Date().toISOString().slice(0, 10)}.zip`; link.click(); URL.revokeObjectURL(url); setMessage('Kopia została pobrana.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Błąd tworzenia kopii.'); } finally { setBusy(false); } };
  const connectOAuth = async (selected: Exclude<Provider, 'webdav'>) => { setProvider(selected); setBusy(true); try { const response = await fetch(`${apiUrl}/api/backup/oauth/${selected}/start`, { headers: await authorize('connect'), redirect: 'manual' }); const location = response.headers.get('Location'); if (!location) throw new Error((await response.json().catch(() => ({}))).error || 'Brak konfiguracji OAuth.'); window.open(location, '_blank', 'noopener,noreferrer'); setMessage('Dokończ autoryzację w nowym oknie.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Nie udało się połączyć chmury.'); } finally { setBusy(false); } };
  const saveSettings = async () => { setBusy(true); setMessage('Zapisywanie ustawień…'); try { const headers = await authorize('send'); const response = await fetch(`${apiUrl}/api/backup/destination`, { method: 'PUT', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, endpoint: provider === 'webdav' ? nasEndpoint() : endpoint, remoteFolder, schedule: schedule === 'manual' ? 'manual' : `${schedule}@${scheduleTime}`, username, backupUsername, backupPassword }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Nie udało się zapisać ustawień.'); if (backupPassword) { setBackupCredentialSaved(true); setBackupPassword(''); } setMessage('Ustawienia kopii zostały zapisane.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Błąd zapisu ustawień.'); } finally { setBusy(false); } };
  const upload = async (credentials: BackupActionCredentials) => { setBusy(true); setMessage('Wysyłanie kopii…'); try { const protectedHeaders = await authorize('send', credentials.code); setSending(true); const response = await fetch(`${apiUrl}/api/backup/cloud`, { method: 'POST', headers: { ...protectedHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: credentials.username, password: credentials.password }) }); const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Nie udało się wysłać kopii.'); setMessage(provider === 'webdav' ? 'Kopia została wysłana na serwer NAS.' : 'Kopia została wysłana do chmury.'); } catch (error) { setMessage(error instanceof Error ? error.message : 'Błąd wysyłki kopii.'); } finally { setSending(false); setBusy(false); } };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3 sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="backup-title" className="flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-600 bg-[#0f172a] shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-5 py-4 sm:px-6">
          <h2 id="backup-title" className="text-xl font-bold text-white">☁️ {section === 'settings' ? 'Ustawienia kopii zapasowej' : section === 'send' ? 'Wysyłanie kopii zapasowej' : 'Przywracanie kopii zapasowej'}</h2>
          <button type="button" aria-label="Zamknij" disabled={sending} onClick={onClose} className="text-2xl text-slate-400">×</button>
        </div>
        <div className="overflow-y-auto p-5 sm:p-6">
          <div className={section === 'settings' ? "grid grid-cols-1 gap-6 md:grid-cols-2" : "mx-auto max-w-xl"}>
            {section === 'settings' && <div className="min-w-0">
              <h3 className="font-semibold text-white">Miejsce kopii</h3>
              <InfoTip label="miejsce kopii">Wybierz, gdzie przechowywać kopię dokumentów. NAS i chmura wymagają wcześniej skonfigurowanego dostępu. Ręczny eksport ZIP pobiera kopię na komputer.</InfoTip>
              <div className="mt-3 grid grid-cols-3 gap-2">{(['google-drive', 'onedrive', 'dropbox'] as const).map(item => <button key={item} disabled={busy} onClick={() => { setDestination('cloud'); void connectOAuth(item); }} className="rounded-lg border border-slate-600 p-2 text-xs text-slate-200">{item === 'google-drive' ? 'Google Drive' : item === 'onedrive' ? 'OneDrive' : 'Dropbox'}</button>)}</div>
              <select aria-label="Miejsce kopii" value={destination} onChange={event => setDestination(event.target.value as Destination)} className="mt-3 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white"><option value="computer">Komputer / ręczny eksport</option><option value="cloud">Chmura lub serwer NAS</option></select>
              {destination === 'cloud' && <>
                <select aria-label="Dostawca chmury" value={provider} onChange={event => setProvider(event.target.value as Provider)} className="mt-3 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white"><option value="webdav">NAS (QNAP, Synology) / WebDAV</option><option value="google-drive">Google Drive</option><option value="onedrive">OneDrive</option><option value="dropbox">Dropbox</option></select>
                {provider === 'webdav' && <>
                  <select aria-label="Rodzaj serwera NAS" value={nasType} onChange={event => { setNasType(event.target.value as typeof nasType); setRemoteFolder(''); }} className="mt-3 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white"><option value="qnap">QNAP — domyślny port WebDAV HTTPS 5001</option><option value="synology">Synology — domyślny port WebDAV HTTPS 5006</option><option value="other">Inny NAS / własny port</option></select>
                  <input aria-label="Adres NAS" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="Adres IP lub nazwa, np. 192.168.0.12" className="mt-3 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" />
                  <input aria-label="Użytkownik NAS" value={username} onChange={event => setUsername(event.target.value)} placeholder="Użytkownik NAS" className="mt-3 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" />
                  <input aria-label="Hasło NAS" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Twoje hasło NAS — wymagane przy połączeniu" className="mt-3 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" />
                  <p className="mt-2 text-xs text-slate-400">Twoje hasło nie jest zapisywane. Po zamknięciu okna podaj je ponownie.</p>
                </>}
                <input aria-label="Folder docelowy" value={remoteFolder} onChange={event => setRemoteFolder(event.target.value)} placeholder="Folder docelowy / ID folderu" className="mt-3 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" />
                <select aria-label="Harmonogram kopii" value={schedule} onChange={event => setSchedule(event.target.value as Schedule)} className="mt-3 w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white"><option value="manual">Tylko ręcznie</option><option value="daily">Codziennie</option><option value="weekly">W poniedziałek</option></select>
                {schedule !== 'manual' && provider === 'webdav' && <div className="mt-3 rounded-lg border border-amber-700/60 p-3 text-sm text-slate-200"><p>Osobne konto NAS do automatycznej kopii</p><p className="mt-1 text-xs text-slate-400">Na NAS-ie nadaj mu dostęp wyłącznie do folderu kopii. Jego hasło będzie zapisane zaszyfrowane, aby automat mógł się zalogować.</p><input aria-label="Konto NAS do kopii" value={backupUsername} onChange={event => setBackupUsername(event.target.value)} placeholder="Użytkownik do kopii" className="mt-2 w-full rounded-lg border border-slate-600 bg-[#111827] p-2 text-white" /><input aria-label="Hasło konta kopii" type="password" value={backupPassword} onChange={event => setBackupPassword(event.target.value)} placeholder={backupCredentialSaved ? 'Hasło konta kopii zapisane — wpisz, aby zmienić' : 'Hasło konta kopii'} className="mt-2 w-full rounded-lg border border-slate-600 bg-[#111827] p-2 text-white" /></div>}
                {schedule !== 'manual' && provider === 'webdav' && <InfoTip label="konto automatycznej kopii">Utwórz na NAS-ie osobne konto i nadaj mu dostęp tylko do folderu kopii. Automat używa jego zaszyfrowanego hasła, ponieważ nie może poprosić o kod lub hasło podczas pracy w tle.</InfoTip>}
                {schedule !== 'manual' && <label className="mt-3 block text-sm text-slate-300">Godzina kopii<input type="time" value={scheduleTime} onChange={event => setScheduleTime(event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-600 bg-[#111827] p-3 text-white" /></label>}
                {schedule !== 'manual' && <p className="mt-2 text-xs text-amber-200">Jeśli serwer wtedy nie działał, spróbuje wykonać ją po następnym uruchomieniu. Zamknięcie okna ukrywa aplikację przy zegarze; „Zakończ E-Teczkę” wyłącza ją całkowicie. Komputer i NAS muszą być dostępne.</p>}
                {schedule !== 'manual' && <InfoTip label="harmonogram">Kopia zostanie wykonana o wybranej godzinie, gdy E-Teczka i komputer działają. Po pominięciu terminu serwer spróbuje ją wykonać po ponownym uruchomieniu. NAS musi być dostępny.</InfoTip>}
              </>}
            </div>}
            <div className="min-w-0">
              <h3 className="font-semibold text-white">{section === 'settings' ? 'Folder i zabezpieczenia' : section === 'send' ? 'Utwórz kopię' : 'Przywróć dane'}</h3>
              {section !== 'settings' && destination === 'computer' && !settingsLoading && <p className="mt-3 rounded-lg bg-slate-800 p-3 text-sm text-slate-300">Nie skonfigurowano chmury ani NAS-a. Wybierz „Ustawienia kopii”, aby dodać miejsce zapisu. Możesz też użyć lokalnego pliku ZIP.</p>}
              {lastBackup?.at && <p className="mt-2 text-xs text-slate-300">Ostatnia zaplanowana próba: {new Date(lastBackup.at).toLocaleString('pl-PL')} — {lastBackup.status === 'success' ? 'powodzenie' : 'błąd'}{lastBackup.error ? ` (${lastBackup.error})` : ''}</p>}
              {destination === 'cloud' && <>
                {section === 'settings' && provider === 'webdav' && <WebDavFolderPicker fetcher={fetch} key={`${nasType}:${endpoint}:${username}`} apiUrl={apiUrl} endpoint={nasEndpoint()} username={username} password={password} selected={remoteFolder} onSelect={setRemoteFolder} onEndpointChange={setEndpoint} authHeaders={authHeaders} disabled={busy} />}
                {section === 'settings' && <button disabled={busy || settingsLoading || mfaEnabled === null} onClick={() => void saveSettings()} className="mt-3 w-full rounded-lg bg-blue-600 py-3 font-bold text-white disabled:opacity-50">Zapisz ustawienia kopii</button>}
                {section === 'send' && <button disabled={busy || settingsLoading || mfaEnabled === null} onClick={() => setActionDialog('send')} className="mt-3 w-full rounded-lg bg-emerald-600 py-3 font-bold text-white disabled:opacity-50">Wyślij kopię do chmury lub NAS-a</button>}
                {section === 'restore' && <button disabled={busy || mfaEnabled === null} onClick={() => { if (window.confirm('Przywrócenie zastąpi bieżące kartoteki i dokumenty stanem z kopii. Zmiany wykonane po utworzeniu kopii znikną z aplikacji. Kontynuować?')) setActionDialog('restore'); }} className="mt-3 w-full rounded-lg border border-blue-400 py-3 font-bold text-blue-200 disabled:opacity-50">Pobierz i przywróć najnowszą kopię</button>}
                <InfoTip label="wysłanie i przywrócenie kopii">Wysłanie tworzy zaszyfrowaną kopię dokumentów i zapisuje ją w wybranym miejscu. Przywrócenie pobiera ostatnią kopię i odtwarza z niej dokumenty. Przy ręcznej operacji podajesz dane NAS-a i kod Authenticatora, jeśli go włączono.</InfoTip>
              </>}
              {section === 'send' && <button disabled={busy} onClick={() => void exportBackup()} className="mt-3 w-full rounded-lg bg-blue-600 py-3 font-bold text-white">Utwórz i pobierz kopię ZIP</button>}
              {section === 'restore' && <label className="mt-3 block cursor-pointer rounded-lg border border-dashed border-slate-500 p-4 text-center text-sm text-slate-300"><span>Wybierz kopię do przywrócenia</span><input disabled={busy} type="file" accept=".zip,.enc,application/zip" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file && window.confirm('Przywrócenie zastąpi bieżące kartoteki i dokumenty stanem z kopii. Zmiany wykonane po utworzeniu kopii znikną z aplikacji. Kontynuować?')) void restore(file); event.target.value = '';  }} /></label>}
              {section !== 'settings' && <InfoTip label="lokalna kopia ZIP">Ten przycisk pobiera kopię ZIP na komputer. Wybranie pliku przywraca z niego dokumenty. Ręczny ZIP nie jest szyfrowany, więc przechowuj go w bezpiecznym miejscu.</InfoTip>}
              {section === 'settings' && <BackupAuthenticatorSetup apiUrl={apiUrl} headers={authHeaders} enabled={mfaEnabled} onChange={setMfaEnabled} />}
              {section !== 'send' && <BackupRecoveryKey apiUrl={apiUrl} mode={section} authorize={authorize} disabled={busy} onRecovery={(file, password) => { setRecoveryFile(file); setRecoveryPassword(password); }} />}
              {section !== 'settings' && destination === 'cloud' && <p className="mt-3 break-all text-xs text-slate-400">Zapisane miejsce: {provider === 'webdav' ? `${endpoint}/${remoteFolder}` : provider}</p>}
              {message && <p role="status" className="mt-4 rounded-lg bg-slate-800 p-3 text-sm text-slate-300">{message}</p>}
            </div>
          </div>
        </div>
      </section>
      {actionDialog && <BackupActionDialog key={actionDialog} action={actionDialog} needsNas={provider === 'webdav'} needsMfa={mfaEnabled === true} username={username} onCancel={() => setActionDialog(null)} onSubmit={credentials => { const action = actionDialog; setActionDialog(null); if (action === 'send') void upload(credentials); else void restoreLatestCloud(credentials); }} />}
      {sending && <BackupTransferAnimation destination={provider === 'webdav' ? 'nas' : 'cloud'} />}
      {mfaPromptOpen && <BackupAuthenticatorDialog onCancel={() => { const pending = pendingMfa.current; pendingMfa.current = null; setMfaPromptOpen(false); pending?.reject(new Error('Anulowano potwierdzanie operacji.')); }} onSubmit={code => { const pending = pendingMfa.current; pendingMfa.current = null; setMfaPromptOpen(false); pending?.resolve(code); }} />}
    </div>
  );
}
