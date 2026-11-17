import { useState } from 'react';
import type { UpdateInfo } from '../hooks/useAppUpdateCheck';

type DelayChoice = '15' | '60' | 'next_launch';

type Props = {
  update: UpdateInfo;
  onUpdateNow: () => void;
  onPostpone: (minutes: number | 'next_launch') => void;
};

/** Prompts the user when a new app update is deployed and asks when to apply it. */
export default function AppUpdatePromptModal({ update, onUpdateNow, onPostpone }: Props) {
  const [delay, setDelay] = useState<DelayChoice>('15');
  const formattedTime = new Date(update.builtAt).toLocaleString('pl-PL');

  const handlePostpone = () => {
    if (delay === 'next_launch') onPostpone('next_launch');
    else onPostpone(Number(delay));
  };

  return (
    <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="app-update-title" className="w-full max-w-md rounded-2xl border border-blue-500/50 bg-[#0f172a] p-6 text-slate-200 shadow-2xl">
        <p className="text-xs font-bold uppercase tracking-wider text-blue-400">Aktualizacja E‑Teczki</p>
        <h2 id="app-update-title" className="mt-1 text-xl font-bold text-white">Dostępna jest nowa wersja aplikacji</h2>
        <p className="mt-2 text-xs text-slate-400">
          Opublikowano aktualizację ({formattedTime}). Twoja obecna sesja i otwarte dane są bezpieczne — wybierz, kiedy chcesz odświeżyć aplikację.
        </p>

        <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
          <label htmlFor="update-delay-select" className="block text-xs font-semibold text-slate-300">
            Jeśli nie teraz, kiedy przypomnieć?
          </label>
          <select
            id="update-delay-select"
            value={delay}
            onChange={e => setDelay(e.target.value as DelayChoice)}
            className="mt-2 w-full rounded-lg border border-slate-600 bg-[#111827] px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="15">Za 15 minut</option>
            <option value="60">Za 1 godzinę</option>
            <option value="next_launch">Przy kolejnym uruchomieniu aplikacji</option>
          </select>
        </div>

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={handlePostpone} className="rounded-lg border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-300 hover:bg-slate-800">
            Przypomnij później
          </button>
          <button type="button" onClick={onUpdateNow} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-500">
            Zaktualizuj teraz
          </button>
        </div>
      </section>
    </div>
  );
}
