import { useState } from 'react';
import { customIconLimit, DEFAULT_FOLDER_ICONS, fileToIconDataUrl, loadCustomIcons, saveCustomIcons, type CustomFolderIcon } from '../services/customIcons';
import { FolderIconView, PRESET_FOLDER_ICONS, suggestFolderIcon } from './FolderIconPicker';

type Props = {
  isSubfolder: boolean;
  plan: 'free' | 'standard' | 'premium';
  onSubmit: (name: string, icon: string) => Promise<void> | void;
  onCancel: () => void;
};

/** Modal for creating a folder or subfolder with live icon suggestion and large icon picker. */
export default function FolderCreateModal({ isSubfolder, plan, onSubmit, onCancel }: Props) {
  const [name, setName] = useState('');
  const [customNameTyped, setCustomNameTyped] = useState(false);
  const [manualIcon, setManualIcon] = useState<string | null>(null);
  const [customIcons, setCustomIcons] = useState<CustomFolderIcon[]>(loadCustomIcons);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const suggested = suggestFolderIcon(name);
  const activeIcon = manualIcon ?? suggested;
  const limit = customIconLimit(plan);
  const atLimit = limit !== null && customIcons.length >= limit;

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    if (atLimit) {
      setError(`Limit własnych ikon dla planu (${limit}) został osiągnięty.`);
      return;
    }
    try {
      const dataUrl = await fileToIconDataUrl(file);
      const next = [...customIcons, { id: `ci_${Date.now()}`, dataUrl }];
      setCustomIcons(next);
      saveCustomIcons(next);
      setManualIcon(dataUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się dodać ikony.');
    }
  };

  const handleConfirm = async () => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await onSubmit(trimmed, activeIcon);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-600 bg-[#0f172a] shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 className="text-lg font-bold text-white">{isSubfolder ? 'Nowa podkartoteka' : 'Nowa kartoteka'}</h2>
          <button type="button" aria-label="Anuluj" onClick={onCancel} className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </header>
        <div className="space-y-5 overflow-y-auto p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-2xl border border-blue-500/60 bg-slate-900 shadow-inner">
              <FolderIconView icon={activeIcon} size="lg" />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">Nazwa {isSubfolder ? 'podkartoteki' : 'kartoteki'}</label>
              <input
                autoFocus
                value={name}
                onChange={e => { setName(e.target.value); setCustomNameTyped(Boolean(e.target.value.trim())); }}
                onKeyDown={e => e.key === 'Enter' && void handleConfirm()}
                placeholder="np. Faktury, Umowy, Samochód, Zdrowie..."
                className="w-full rounded-xl border border-slate-600 bg-[#111827] px-4 py-2.5 text-sm text-white outline-none focus:border-blue-400"
              />
              {manualIcon === null && suggested !== '📁' && (
                <p className="text-xs text-sky-300">✨ Automatycznie dopasowano ikonę do nazwy</p>
              )}
            </div>
          </div>

          {suggested !== '📁' && (() => {
            const suggestedLabel = PRESET_FOLDER_ICONS.find(i => i.id === suggested)?.label || '';
            const applySuggested = () => {
              if (suggestedLabel) setName(suggestedLabel);
              setManualIcon(null);
            };
            return (
              <div
                role="button"
                tabIndex={0}
                onClick={applySuggested}
                onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && applySuggested()}
                title={suggestedLabel ? `Kliknij, aby ustawić nazwę „${suggestedLabel}”` : undefined}
                className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-sky-500/50 bg-sky-950/30 p-3 transition hover:border-sky-400 hover:bg-sky-950/50"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border border-sky-400/50 bg-slate-900">
                    <FolderIconView icon={suggested} size="lg" />
                  </div>
                  <div>
                    <p className="text-xs font-bold uppercase tracking-wider text-sky-300">✨ Dopasowana ikona</p>
                    <p className="text-sm font-semibold text-white">{suggestedLabel || 'Dopasowana ikona'}</p>
                    {suggestedLabel && name.trim() !== suggestedLabel && (
                      <p className="text-[11px] text-sky-300">Kliknij, aby przypisać nazwę „{suggestedLabel}”</p>
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {suggestedLabel && name.trim() !== suggestedLabel && (
                    <button type="button" onClick={e => { e.stopPropagation(); applySuggested(); }} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-500">
                      Użyj nazwy
                    </button>
                  )}
                  {manualIcon !== null ? (
                    <button type="button" onClick={e => { e.stopPropagation(); setManualIcon(null); }} className="rounded-lg border border-sky-400/60 bg-sky-500/20 px-3 py-1.5 text-xs font-bold text-sky-200 hover:bg-sky-500/30">
                      Użyj ikony
                    </button>
                  ) : (
                    <span className="rounded-full bg-sky-500/20 px-3 py-1 text-xs font-bold text-sky-200">✓ Wybrano</span>
                  )}
                </div>
              </div>
            );
          })()}

          <div className="space-y-3">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">Wybierz ikonę kartoteki</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {PRESET_FOLDER_ICONS.map(item => {
                const selected = activeIcon === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => { setManualIcon(item.id); if (!customNameTyped || !name.trim()) setName(item.label); }}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border p-3 text-center transition ${
                      selected ? 'border-blue-400 bg-blue-950/50 ring-1 ring-blue-400' : 'border-slate-700 bg-[#111827]/70 hover:border-slate-500 hover:bg-slate-800/70'
                    }`}
                  >
                    <img src={item.src} alt={item.label} className="h-12 w-12 object-contain" />
                    <span className="line-clamp-1 text-[11px] font-medium text-slate-200">{item.label}</span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {DEFAULT_FOLDER_ICONS.map(ic => {
                const selected = activeIcon === ic;
                return (
                  <button
                    key={ic}
                    type="button"
                    onClick={() => setManualIcon(ic)}
                    className={`flex h-12 w-12 items-center justify-center rounded-xl border text-2xl transition ${
                      selected ? 'border-blue-400 bg-blue-950/50 ring-1 ring-blue-400' : 'border-slate-700 bg-[#111827]/70 hover:border-slate-500'
                    }`}
                  >
                    {ic === '📁' ? <FolderIconView icon={ic} size="md" /> : ic}
                  </button>
                );
              })}
              {customIcons.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setManualIcon(item.dataUrl)}
                  className={`flex h-12 w-12 items-center justify-center rounded-xl border p-1.5 transition ${
                    activeIcon === item.dataUrl ? 'border-blue-400 bg-blue-950/50 ring-1 ring-blue-400' : 'border-slate-700 bg-[#111827]/70 hover:border-slate-500'
                  }`}
                >
                  <img src={item.dataUrl} alt="" className="h-9 w-9 rounded object-contain" />
                </button>
              ))}
              <label className={`cursor-pointer rounded-xl border border-dashed px-3 py-2.5 text-xs font-semibold ${atLimit ? 'border-slate-700 text-slate-500' : 'border-blue-500/60 text-blue-300 hover:bg-blue-950/30'}`}>
                + Własna ikona
                <input type="file" accept="image/*" className="hidden" disabled={atLimit} onChange={e => { void handleUpload(e.target.files?.[0]); e.target.value = ''; }} />
              </label>
            </div>
            {error && <p className="text-xs text-red-300">{error}</p>}
          </div>
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-700 px-6 py-4">
          <button type="button" onClick={onCancel} className="rounded-lg border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Anuluj</button>
          <button type="button" disabled={!name.trim() || busy} onClick={() => void handleConfirm()} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-bold text-white hover:bg-blue-500 disabled:opacity-50">
            {busy ? 'Tworzenie…' : 'Utwórz'}
          </button>
        </footer>
      </section>
    </div>
  );
}
