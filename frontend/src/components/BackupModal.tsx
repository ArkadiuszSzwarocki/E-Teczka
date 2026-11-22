import BackupRecoveryKey from './BackupRecoveryKey';
import BackupActionDialog from './BackupActionDialog';
import InfoTip from './InfoTip';
import BackupTransferAnimation from './BackupTransferAnimation';
import BackupAuthenticatorDialog from './BackupAuthenticatorDialog';
import BackupSettingsView from './BackupSettingsView';
import { BackupSettingsTransferCard } from './BackupSettingsTransferCard';
import { BACKUP_PROVIDER_LABELS, useBackupManager, type BackupSection } from '../hooks/useBackupManager';

export type { BackupSection };
type Props = { embedded?: boolean; fetcher: typeof fetch; apiUrl: string; section: BackupSection; isPremiumPlan?: boolean; onClose: () => void; onDone: (message?: string) => void };

/** Modal for configuring, sending, and restoring encrypted cloud or local ZIP backups. */
export default function BackupModal({ embedded = false, apiUrl, section, isPremiumPlan = false, onClose, onDone, fetcher }: Props) {
  const mgr = useBackupManager({ apiUrl, fetcher, onDone });

  return (
    <div className={embedded ? 'w-full' : 'fixed inset-0 z-[120] flex items-center justify-center bg-black/80 p-3 sm:p-5'}>
      <section role={embedded ? undefined : 'dialog'} aria-modal={embedded ? undefined : 'true'} aria-labelledby="backup-title" className={embedded ? 'flex w-full flex-col overflow-hidden rounded-2xl border border-slate-700/80 bg-[#0f172a] shadow-xl' : 'flex max-h-full w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-600 bg-[#0f172a] shadow-2xl'}>
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-5 py-4 sm:px-6">
          <h2 id="backup-title" className="text-xl font-bold text-white">☁️ {section === 'settings' ? 'Ustawienia kopii zapasowej' : section === 'send' ? 'Wysyłanie kopii zapasowej' : 'Przywracanie kopii zapasowej'}</h2>
          <button type="button" aria-label="Zamknij" disabled={mgr.sending} onClick={onClose} className="rounded-lg px-2 py-1 text-2xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </div>
        <div className="space-y-5 overflow-y-auto p-5 sm:p-6">
          <BackupSettingsTransferCard apiUrl={apiUrl} fetcher={fetcher} isPremiumPlan={isPremiumPlan} />
          {section === 'settings' ? (
            <BackupSettingsView
              apiUrl={apiUrl}
              fetcher={fetcher}
              destination={mgr.destination}
              provider={mgr.provider}
              selectedChoice={mgr.selectedChoice}
              selectDestinationChoice={mgr.selectDestinationChoice}
              nasType={mgr.nasType}
              setNasType={mgr.setNasType}
              endpoint={mgr.endpoint}
              setEndpoint={mgr.setEndpoint}
              username={mgr.username}
              setUsername={mgr.setUsername}
              password={mgr.password}
              setPassword={mgr.setPassword}
              remoteFolder={mgr.remoteFolder}
              setRemoteFolder={mgr.setRemoteFolder}
              schedule={mgr.schedule}
              setSchedule={mgr.setSchedule}
              useSeparateBackupAccount={mgr.useSeparateBackupAccount}
              setUseSeparateBackupAccount={mgr.setUseSeparateBackupAccount}
              backupUsername={mgr.backupUsername}
              setBackupUsername={mgr.setBackupUsername}
              backupPassword={mgr.backupPassword}
              setBackupPassword={mgr.setBackupPassword}
              backupCredentialSaved={mgr.backupCredentialSaved}
              nasEndpoint={mgr.nasEndpoint}
              authHeaders={mgr.authHeaders}
              busy={mgr.busy}
              settingsLoading={mgr.settingsLoading}
              mfaEnabled={mgr.mfaEnabled}
              onExportBackup={() => void mgr.exportBackup()}
              onConnectOAuth={selected => void mgr.connectOAuth(selected)}
              onSaveSettings={() => void mgr.saveSettings()}
            />
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div className="space-y-3 rounded-xl border border-slate-700/80 bg-[#111827]/70 p-5">
                  <h3 className="text-base font-bold text-white">{section === 'send' ? '☁️ Kopia w chmurze lub na NAS' : '☁️ Przywróć z chmury lub NAS'}</h3>
                  {mgr.destination === 'computer' && !mgr.settingsLoading ? (
                    <p className="rounded-lg bg-slate-800/80 p-3 text-sm text-slate-300">Nie skonfigurowano chmury ani NAS-a. Wybierz „Ustawienia kopii”, aby dodać miejsce zapisu.</p>
                  ) : (
                    <>
                      <p className="break-all text-xs text-slate-400">Skonfigurowane miejsce: <strong className="text-slate-200">{mgr.provider === 'webdav' ? `${mgr.endpoint}/${mgr.remoteFolder}` : BACKUP_PROVIDER_LABELS[mgr.provider]}</strong></p>
                      {mgr.lastBackup?.at && <p className="text-xs text-slate-300">Ostatnia próba: {new Date(mgr.lastBackup.at).toLocaleString('pl-PL')} — {mgr.lastBackup.status === 'success' ? 'powodzenie' : 'błąd'}{mgr.lastBackup.error ? ` (${mgr.lastBackup.error})` : ''}</p>}
                      {section === 'send' && <button disabled={mgr.busy || mgr.settingsLoading || mgr.mfaEnabled === null} onClick={() => mgr.setActionDialog('send')} className="w-full rounded-lg bg-emerald-600 py-3 font-bold text-white hover:bg-emerald-500 disabled:opacity-50">Wyślij kopię do chmury lub NAS-a</button>}
                      {section === 'restore' && (
                        <div className="space-y-2">
                          <button disabled={mgr.busy || mgr.mfaEnabled === null} onClick={() => mgr.setConfirmRestore({ kind: 'cloud' })} className="w-full rounded-lg border border-blue-400 py-3 font-bold text-blue-200 hover:bg-blue-500/10 disabled:opacity-50">Pobierz i przywróć najnowszą kopię</button>
                          <button type="button" disabled={mgr.busy || mgr.mfaEnabled === null} onClick={() => mgr.setActionDialog('list')} className="w-full rounded-lg border border-slate-600 bg-slate-800/70 py-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-50">Wybierz wersję z historii kopii</button>
                          {mgr.cloudBackups && (
                            <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-slate-700 bg-[#0f172a] p-2">
                              {mgr.cloudBackups.length === 0 ? (
                                <p className="p-2 text-xs text-slate-400">Brak zapisanych kopii w tym folderze.</p>
                              ) : mgr.cloudBackups.map(item => (
                                <div key={item.name} className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-900/80 px-2.5 py-2 text-xs">
                                  <div className="min-w-0">
                                    <p className="truncate font-semibold text-slate-200">{item.name}</p>
                                    {item.modifiedAt && <p className="text-[10px] text-slate-400">{new Date(item.modifiedAt).toLocaleString('pl-PL')}</p>}
                                  </div>
                                  <button type="button" onClick={() => mgr.setConfirmRestore({ kind: 'cloud', filename: item.name })} className="shrink-0 rounded bg-blue-600 px-2.5 py-1 font-bold text-white hover:bg-blue-500">Przywróć</button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                      <InfoTip label="wysłanie i przywrócenie kopii">Wysłanie tworzy zaszyfrowaną kopię dokumentów i zapisuje ją w wybranym miejscu. Przywrócenie pobiera ostatnią kopię i odtwarza z niej dokumenty.</InfoTip>
                    </>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-slate-700/80 bg-[#111827]/70 p-5">
                  <h3 className="text-base font-bold text-white">{section === 'send' ? '💻 Lokalna kopia ZIP' : '💻 Przywróć z pliku ZIP'}</h3>
                  {section === 'send' && <button disabled={mgr.busy} onClick={() => void mgr.exportBackup()} className="w-full rounded-lg bg-blue-600 py-3 font-bold text-white hover:bg-blue-500 disabled:opacity-50">Utwórz i pobierz kopię ZIP</button>}
                  {section === 'restore' && <label className="block cursor-pointer rounded-lg border border-dashed border-slate-500 bg-slate-900/60 p-5 text-center text-sm text-slate-300 hover:border-blue-400"><span>Wybierz plik kopii (.zip / .enc)</span><input disabled={mgr.busy} type="file" accept=".zip,.enc,application/zip" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) mgr.setConfirmRestore({ kind: 'file', file }); event.target.value = ''; }} /></label>}
                  <InfoTip label="lokalna kopia ZIP">Pobiera kopię ZIP na komputer albo przywraca dokumenty ze wskazanego pliku. Ręczny ZIP nie jest szyfrowany, więc przechowuj go w bezpiecznym miejscu.</InfoTip>
                </div>
              </div>
              {section === 'restore' && (
                <div className="rounded-xl border border-slate-700/80 bg-[#111827]/70 p-4 sm:p-5">
                  <BackupRecoveryKey apiUrl={apiUrl} mode={section} authorize={mgr.authorize} disabled={mgr.busy} onRecovery={(file, password) => { mgr.setRecoveryFile(file); mgr.setRecoveryPassword(password); }} />
                </div>
              )}
            </div>
          )}
          {mgr.completedMessage ? (
            <div role="status" className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/60 bg-emerald-950/40 p-4 text-sm font-medium text-emerald-100">
              <span>✅ {mgr.completedMessage} Okno zamknie się za chwilę.</span>
              <button type="button" onClick={() => onDone(mgr.completedMessage!)} className="shrink-0 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-500">Zamknij teraz</button>
            </div>
          ) : mgr.message && <p role="status" className="mt-4 rounded-lg border border-slate-700 bg-slate-800 p-3 text-sm text-slate-200">{mgr.message}</p>}
        </div>
      </section>
      {mgr.confirmRestore && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/80 p-4">
          <section role="dialog" aria-modal="true" className="w-full max-w-md rounded-xl border border-slate-600 bg-[#172338] p-6 shadow-2xl">
            <h2 className="text-lg font-bold text-white">Potwierdź przywracanie kopii</h2>
            <p className="mt-3 text-sm text-slate-300">Przywrócenie zastąpi bieżące kartoteki i dokumenty stanem z kopii{mgr.confirmRestore.kind === 'cloud' && mgr.confirmRestore.filename ? ` (${mgr.confirmRestore.filename})` : ''}. Zmiany wykonane po utworzeniu kopii znikną z aplikacji. Kontynuować?</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => mgr.setConfirmRestore(null)} className="rounded px-4 py-2 text-slate-300">Anuluj</button>
              <button type="button" onClick={() => { const next = mgr.confirmRestore!; mgr.setConfirmRestore(null); if (next.kind === 'cloud') { const hasNas = mgr.provider !== 'webdav' || Boolean(mgr.cachedNasCredentials); if (hasNas && mgr.mfaEnabled !== true) { void mgr.restoreLatestCloud({ username: mgr.cachedNasCredentials?.username || '', password: mgr.cachedNasCredentials?.password || '', code: '' }, next.filename); } else { mgr.setSelectedCloudFilename(next.filename); mgr.setActionDialog('restore'); } } else void mgr.restore(next.file); }} className="rounded bg-blue-600 px-4 py-2 font-semibold text-white">Kontynuuj</button>
            </div>
          </section>
        </div>
      )}
      {mgr.actionDialog && <BackupActionDialog key={mgr.actionDialog} action={mgr.actionDialog === 'send' ? 'send' : 'restore'} needsNas={mgr.provider === 'webdav' && !(mgr.actionDialog === 'restore' && mgr.cachedNasCredentials)} needsMfa={mgr.mfaEnabled === true} username={mgr.username} onCancel={() => mgr.setActionDialog(null)} onSubmit={credentials => { const action = mgr.actionDialog; mgr.setActionDialog(null); const resolved = { username: credentials.username || mgr.cachedNasCredentials?.username || '', password: credentials.password || mgr.cachedNasCredentials?.password || '', code: credentials.code }; if (action === 'send') void mgr.upload(resolved); else if (action === 'list') void mgr.listCloudBackups(resolved); else void mgr.restoreLatestCloud(resolved, mgr.selectedCloudFilename); }} />}
      {mgr.transferMode && <BackupTransferAnimation destination={mgr.provider === 'webdav' ? 'nas' : 'cloud'} mode={mgr.transferMode} />}
      {mgr.mfaPromptOpen && <BackupAuthenticatorDialog onCancel={mgr.cancelMfaPrompt} onSubmit={mgr.submitMfaPrompt} />}
    </div>
  );
}
