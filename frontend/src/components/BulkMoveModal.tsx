import { useState, type FormEvent, type ReactNode } from 'react';
import type { RetentionUnit } from '../types/domain';

export type BulkRetention = { enabled: boolean; value: number; unit: RetentionUnit };
type BulkMoveModalProps = {
  isOpen: boolean;
  documentCount: number;
  restoring?: boolean;
  folderOptions: ReactNode;
  onMove: (folderId: number, retention?: BulkRetention) => Promise<boolean>;
  onClose: () => void;
};

export default function BulkMoveModal({ isOpen, documentCount, restoring = false, folderOptions, onMove, onClose }: BulkMoveModalProps) {
  const [folderId, setFolderId] = useState('');
  const [mode, setMode] = useState('');
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<RetentionUnit>('years');
  const [busy, setBusy] = useState(false);
  if (!isOpen) return null;
  const close = () => { setFolderId(''); setMode(''); setValue(''); setUnit('years'); onClose(); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!folderId || (restoring && !mode)) return;
    const duration = Number(value);
    if (restoring && mode === 'timed' && (!Number.isSafeInteger(duration) || duration < 1)) return;
    setBusy(true);
    try {
      const retention = restoring ? { enabled: mode === 'timed', value: mode === 'timed' ? duration : 5, unit } : undefined;
      if (await onMove(Number(folderId), retention)) close();
    } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <form onSubmit={event => void submit(event)} className="w-full max-w-md rounded-xl border border-slate-700 bg-[#1e293b] p-6 shadow-2xl">
        <h3 className="text-lg font-bold text-white">{restoring ? 'Przywróć zaznaczone dokumenty' : 'Przenieś zaznaczone dokumenty'}</h3>
        <p className="mt-2 text-sm text-slate-400">Wybrano: {documentCount} dokumentów.{restoring && ' Wybierz wspólny termin życia liczony od dziś.'}</p>
        <label className="mt-5 block text-sm text-slate-200">Podkartoteka docelowa
          <select required value={folderId} onChange={event => setFolderId(event.target.value)} className="mt-2 w-full rounded-md border border-slate-600 bg-[#0f172a] px-3 py-3 text-white" aria-label="Podkartoteka docelowa">
            <option value="">— wybierz podkartotekę —</option>{folderOptions}
          </select>
        </label>
        {restoring && <fieldset className="mt-5"><legend className="text-sm font-semibold text-slate-200">Nowy termin życia dokumentów</legend>
          <select required value={mode} onChange={event => setMode(event.target.value)} className="mt-2 w-full rounded-md border border-slate-600 bg-[#0f172a] px-3 py-3 text-white" aria-label="Sposób określenia terminu życia">
            <option value="">— wybierz termin —</option><option value="timed">Ustaw czas życia</option><option value="unlimited">Bez automatycznego przenoszenia do kosza</option>
          </select>
          {mode === 'timed' && <div className="mt-2 flex gap-2"><input required type="number" min="1" step="1" value={value} onChange={event => setValue(event.target.value)} aria-label="Czas życia" className="w-28 rounded border border-slate-600 bg-[#0f172a] px-3 py-2 text-white" /><select value={unit} onChange={event => setUnit(event.target.value as RetentionUnit)} aria-label="Jednostka czasu życia" className="flex-1 rounded border border-slate-600 bg-[#0f172a] px-3 py-2 text-white"><option value="years">Lata</option><option value="months">Miesiące</option><option value="days">Dni</option><option value="minutes">Minuty</option></select></div>}
        </fieldset>}
        <div className="mt-6 flex justify-end gap-3"><button type="button" disabled={busy} onClick={close} className="px-4 py-2 text-slate-400 hover:text-white">Anuluj</button><button type="submit" disabled={busy || !folderId || (restoring && !mode)} className="rounded bg-blue-600 px-5 py-2 font-medium text-white hover:bg-blue-500 disabled:opacity-50">{busy ? 'Zapisywanie…' : restoring ? 'Przywróć' : 'Przenieś'}</button></div>
      </form>
    </div>
  );
}
