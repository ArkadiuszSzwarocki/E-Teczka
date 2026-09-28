import type { FormEvent } from 'react';
import type { RetentionUnit } from '../types/domain';

export type RetentionModalState = {
  isOpen: boolean;
  docId: number | null;
  value: number;
  unit: RetentionUnit;
  enabled: boolean;
  restoreFrom?: 'archive' | 'trash';
};

type RetentionModalProps = {
  state: RetentionModalState;
  onStateChange: (state: RetentionModalState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
};

export default function RetentionModal({
  state,
  onStateChange,
  onSubmit,
  onClose,
}: RetentionModalProps) {
  if (!state.isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4 backdrop-blur-sm">
      <div className="bg-[#1e293b] rounded-xl shadow-2xl p-6 w-full max-w-sm border border-slate-700">
        <h3 className="text-white font-bold mb-2 text-lg">
          {state.restoreFrom ? 'Ustaw nowy termin życia' : 'Edycja terminu życia dokumentu'}
        </h3>
        {state.restoreFrom && (
          <p className="text-sm text-slate-400 mb-4">
            Przywrócenie uruchomi nowy termin życia dokumentu od dzisiaj.
          </p>
        )}
        <form onSubmit={onSubmit}>
          <div className="flex gap-2 mb-6">
            <input
              type="number"
              value={state.value}
              onChange={(event) => onStateChange({ ...state, value: Number(event.target.value) })}
              className="w-24 bg-[#0f172a] border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              min="1"
              aria-label="Wartość terminu życia"
            />
            <select
              value={state.unit}
              onChange={(event) => onStateChange({ ...state, unit: event.target.value as RetentionUnit })}
              className="flex-1 bg-[#0f172a] border border-slate-600 rounded px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              aria-label="Jednostka terminu życia"
            >
              <option value="years">Lata</option>
              <option value="months">Miesiące</option>
              <option value="days">Dni</option>
              <option value="minutes">Minuty</option>
            </select>
          </div>
          {!state.restoreFrom && (
            <label className="flex items-center gap-2 text-sm text-slate-300 mb-6">
              <input
                type="checkbox"
                checked={state.enabled}
                onChange={(event) => onStateChange({ ...state, enabled: event.target.checked })}
              />
              Włącz automatyczne przeniesienie do kosza po upływie terminu
            </label>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-400 hover:text-white transition-colors"
            >
              Anuluj
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded font-medium transition-colors shadow-lg"
            >
              {state.restoreFrom ? 'Przywróć dokument' : 'Zapisz zmianę'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
