import { useEffect, useState } from 'react';
import { GENERATOR_BADGE_PRESETS, generateHolographicFolderIcon } from '../services/folderIconGenerator';

type Props = {
  folderName: string;
  atLimit: boolean;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
};

/** Interactive holographic 3D folder icon generator matching MojaTeczka preset icons. */
export function FolderIconGeneratorPanel({ folderName, atLimit, onApply, onCancel }: Props) {
  const initialSymbol = folderName.trim().slice(0, 3).toUpperCase() || '⚡';
  const [symbol, setSymbol] = useState(initialSymbol);
  const [previewUrl, setPreviewUrl] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void generateHolographicFolderIcon(symbol)
      .then(url => { if (active) setPreviewUrl(url); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [symbol]);

  const handleSave = async () => {
    if (atLimit || busy) return;
    setBusy(true);
    try {
      const url = previewUrl || (await generateHolographicFolderIcon(symbol));
      onApply(url);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-cyan-500/40 bg-[#0b1324] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wider text-cyan-300">✨ Generator ikony w stylu MojejTeczki</p>
        <button type="button" onClick={onCancel} className="text-xs text-slate-400 hover:text-white">Zamknij</button>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-cyan-500/40 bg-slate-900">
          {previewUrl && <img src={previewUrl} alt="Podgląd ikony" className="h-14 w-14 object-contain" />}
        </div>
        <div className="min-w-0 flex-1 space-y-1.5">
          <label className="block text-[11px] text-slate-300">Wpisz krótki skrót (np. ZUS, VIP, IT) lub wybierz symbol poniżej:</label>
          <input
            value={symbol}
            maxLength={4}
            onChange={e => setSymbol(e.target.value)}
            placeholder="np. ZUS, B2B, ⚡"
            className="w-full rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-1.5 text-sm text-white outline-none focus:border-cyan-400"
          />
        </div>
      </div>

      <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
        {GENERATOR_BADGE_PRESETS.map(item => (
          <button
            key={item}
            type="button"
            onClick={() => setSymbol(item)}
            className={`flex h-8 w-8 items-center justify-center rounded-lg border text-base transition ${
              symbol === item ? 'border-cyan-400 bg-cyan-950/60' : 'border-slate-700 bg-slate-900/70 hover:border-slate-500'
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <div className="flex justify-end gap-2 pt-1">
        <button
          type="button"
          disabled={atLimit || busy || !previewUrl}
          onClick={() => void handleSave()}
          className="rounded-lg bg-cyan-600 px-4 py-1.5 text-xs font-bold text-white hover:bg-cyan-500 disabled:opacity-40"
        >
          {busy ? 'Generowanie…' : '✨ Użyj wygenerowanej ikony'}
        </button>
      </div>
    </div>
  );
}
