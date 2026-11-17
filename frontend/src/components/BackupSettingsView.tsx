import WebDavFolderPicker from './WebDavFolderPicker';
import InfoTip from './InfoTip';
import BackupDestinationGrid, { type BackupDestinationChoice } from './BackupDestinationGrid';
import { BACKUP_PROVIDER_LABELS, type BackupDestination, type BackupProvider, type BackupSchedule } from '../hooks/useBackupManager';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  destination: BackupDestination;
  provider: BackupProvider;
  selectedChoice: BackupDestinationChoice;
  selectDestinationChoice: (choice: BackupDestinationChoice) => void;
  nasType: 'qnap' | 'synology' | 'other';
  setNasType: (type: 'qnap' | 'synology' | 'other') => void;
  endpoint: string;
  setEndpoint: (value: string) => void;
  username: string;
  setUsername: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  remoteFolder: string;
  setRemoteFolder: (value: string) => void;
  schedule: BackupSchedule;
  setSchedule: (value: BackupSchedule) => void;
  useSeparateBackupAccount: boolean;
  setUseSeparateBackupAccount: (value: boolean) => void;
  backupUsername: string;
  setBackupUsername: (value: string) => void;
  backupPassword: string;
  setBackupPassword: (value: string) => void;
  backupCredentialSaved: boolean;
  nasEndpoint: () => string;
  authHeaders: () => Record<string, string>;
  busy: boolean;
  settingsLoading: boolean;
  mfaEnabled: boolean | null;
  onExportBackup: () => void;
  onConnectOAuth: (provider: Exclude<BackupProvider, 'webdav'>) => void;
  onSaveSettings: () => void;
};

/** Presentational settings form for choosing and configuring backup destination and schedule. */
export default function BackupSettingsView({
  apiUrl, fetcher, destination, provider, selectedChoice, selectDestinationChoice,
  nasType, setNasType, endpoint, setEndpoint, username, setUsername, password, setPassword,
  remoteFolder, setRemoteFolder, schedule, setSchedule, useSeparateBackupAccount, setUseSeparateBackupAccount,
  backupUsername, setBackupUsername, backupPassword, setBackupPassword, backupCredentialSaved,
  nasEndpoint, authHeaders, busy, settingsLoading, mfaEnabled, onExportBackup, onConnectOAuth, onSaveSettings,
}: Props) {
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-slate-700/80 bg-[#111827]/70 p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-white">Wybierz miejsce przechowywania kopii</h3>
            <p className="text-xs text-slate-400">Komputer, własny serwer NAS albo jedna z chmur.</p>
          </div>
          <InfoTip label="miejsce kopii">Wybierz, gdzie przechowywać kopię dokumentów. NAS i chmura wymagają wcześniej skonfigurowanego dostępu. Ręczny eksport ZIP pobiera kopię na komputer.</InfoTip>
        </div>
        <BackupDestinationGrid selected={selectedChoice} disabled={busy} onSelect={selectDestinationChoice} />
      </div>

      {destination === 'computer' ? (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-700/80 bg-[#111827]/60 p-5 text-sm text-slate-300">
          <div>
            <p className="font-semibold text-white">Tryb lokalny (Komputer / ręczny eksport ZIP)</p>
            <p className="mt-1 text-xs text-slate-400">Kopie będą tworzone i pobierane ręcznie jako plik ZIP na dysk komputera. Aby włączyć automatyczną kopię w tle, wybierz powyżej Serwer NAS lub chmurę.</p>
          </div>
          <button type="button" disabled={busy || mfaEnabled === null} onClick={onExportBackup} className="shrink-0 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50">
            Utwórz i pobierz kopię ZIP
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className="space-y-3 rounded-xl border border-slate-700/80 bg-[#111827]/70 p-4 sm:p-5">
              <h4 className="text-sm font-bold text-white">Połączenie i folder docelowy: {BACKUP_PROVIDER_LABELS[provider]}</h4>
              {provider === 'webdav' ? (
                <>
                  <select aria-label="Rodzaj serwera NAS" value={nasType} onChange={event => { setNasType(event.target.value as typeof nasType); setRemoteFolder(''); }} className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2.5 text-sm text-white">
                    <option value="qnap">QNAP — domyślny port WebDAV HTTPS 5001</option>
                    <option value="synology">Synology — domyślny port WebDAV HTTPS 5006</option>
                    <option value="other">Inny NAS / własny port</option>
                  </select>
                  <input aria-label="Adres NAS" value={endpoint} onChange={event => setEndpoint(event.target.value)} placeholder="Adres IP lub nazwa, np. 192.168.0.12" className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2.5 text-sm text-white" />
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <input aria-label="Użytkownik NAS" value={username} onChange={event => setUsername(event.target.value)} placeholder="Użytkownik NAS" className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2.5 text-sm text-white" />
                    <input aria-label="Hasło NAS" type="password" value={password} onChange={event => setPassword(event.target.value)} placeholder="Hasło NAS" className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2.5 text-sm text-white" />
                  </div>
                  <p className="text-xs text-slate-400">Twoje hasło nie jest zapisywane. Po zamknięciu okna podaj je ponownie.</p>
                  <WebDavFolderPicker fetcher={fetcher} key={`${nasType}:${endpoint}:${username}`} apiUrl={apiUrl} endpoint={nasEndpoint()} username={username} password={password} selected={remoteFolder} onSelect={setRemoteFolder} onEndpointChange={setEndpoint} authHeaders={authHeaders} disabled={busy} />
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-xs text-slate-300">Autoryzuj dostęp do wybranej chmury, aby aplikacja mogła wysyłać zaszyfrowane kopie zapasowe.</p>
                  <button type="button" disabled={busy} onClick={() => onConnectOAuth(provider)} className="w-full rounded-lg border border-blue-500/60 bg-blue-600/20 px-4 py-2.5 text-sm font-bold text-blue-200 hover:bg-blue-600/30 disabled:opacity-50">
                    Połącz z {BACKUP_PROVIDER_LABELS[provider]}
                  </button>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-slate-300">Folder docelowy w chmurze (opcjonalnie)</label>
                    <input aria-label="Folder docelowy" value={remoteFolder} onChange={event => setRemoteFolder(event.target.value)} placeholder="np. /Backup/E-Teczka lub ID folderu" className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2.5 text-sm text-white" />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-xl border border-slate-700/80 bg-[#111827]/70 p-4 sm:p-5">
              <h4 className="text-sm font-bold text-white">Harmonogram wysyłania kopii</h4>
              <select aria-label="Harmonogram kopii" value={schedule} onChange={event => setSchedule(event.target.value as BackupSchedule)} className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2.5 text-sm text-white">
                <option value="manual">Tylko ręcznie</option>
                <option value="on_login">Przy logowaniu do aplikacji</option>
                <option value="on_logout">Przy wylogowaniu lub zamykaniu aplikacji</option>
              </select>
              {schedule !== 'manual' && provider === 'webdav' && (
                <div className="space-y-2 rounded-lg border border-slate-700 bg-slate-900/60 p-3 text-xs text-slate-200">
                  <label className="flex cursor-pointer items-center gap-2 font-medium text-slate-200">
                    <input type="checkbox" checked={useSeparateBackupAccount} onChange={e => setUseSeparateBackupAccount(e.target.checked)} className="h-4 w-4 accent-blue-500" />
                    <span>Użyj osobnego konta NAS do automatycznej kopii (opcjonalnie)</span>
                  </label>
                  {!useSeparateBackupAccount ? (
                    <p className="text-[11px] text-slate-400">Automat użyje danych konta NAS podanych po lewej stronie (zaszyfrowanych lokalnie).</p>
                  ) : (
                    <div className="space-y-2 pt-1">
                      <input aria-label="Konto NAS do kopii" value={backupUsername} onChange={event => setBackupUsername(event.target.value)} placeholder="Użytkownik do kopii" className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2 text-white" />
                      <input aria-label="Hasło konta kopii" type="password" value={backupPassword} onChange={event => setBackupPassword(event.target.value)} placeholder={backupCredentialSaved ? 'Hasło zapisane — wpisz, aby zmienić' : 'Hasło konta kopii'} className="w-full rounded-lg border border-slate-600 bg-[#0f172a] p-2 text-white" />
                    </div>
                  )}
                </div>
              )}
              {schedule === 'on_login' && (
                <p className="text-[11px] text-sky-300">Po zalogowaniu pojawi się małe okno ze statusem wysyłania kopii zapasowej w tle.</p>
              )}
              {schedule === 'on_logout' && (
                <p className="text-[11px] text-amber-200/90">Przed wylogowaniem lub zamknięciem pojawi się okno statusu wysyłania kopii, a po zakończeniu aplikacja dokończy wylogowanie.</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700/80 bg-[#111827]/70 px-4 py-3">
            <span className="text-xs text-slate-400">Zabezpieczenia MFA i klucz odzyskiwania znajdziesz w <strong className="text-slate-200">Ustawienia aplikacji → Zabezpieczenia kopii</strong>.</span>
            <button type="button" disabled={busy || settingsLoading || mfaEnabled === null} onClick={onSaveSettings} className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50">
              Zapisz ustawienia kopii
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
