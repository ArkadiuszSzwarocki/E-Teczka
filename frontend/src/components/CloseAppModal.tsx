type Props = {
  onMinimize: () => void;
  onQuit: () => void;
  onCancel: () => void;
};

/** Styled in-app close confirmation dialog (minimize to tray or quit). */
export default function CloseAppModal({ onMinimize, onQuit, onCancel }: Props) {
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <section role="dialog" aria-modal="true" aria-labelledby="close-app-title" className="w-full max-w-md overflow-hidden rounded-2xl border border-slate-600 bg-[#0f172a] shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-700 px-6 py-4">
          <h2 id="close-app-title" className="text-lg font-bold text-white">🖥️ Zamykanie E-Teczki</h2>
          <button type="button" aria-label="Anuluj" onClick={onCancel} className="rounded-lg px-2 py-1 text-2xl leading-none text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </header>
        <div className="space-y-4 p-6">
          <p className="text-sm font-semibold text-slate-100">Czy zminimalizować aplikację do zasobnika przy zegarze?</p>
          <p className="text-xs leading-relaxed text-slate-400">
            Po zminimalizowaniu aplikacja pozostanie aktywna przy zegarze. Wybierz „Zamknij aplikację”, aby całkowicie ją wyłączyć.
          </p>
          <div className="flex flex-col gap-2.5 pt-2">
            <button type="button" onClick={onMinimize} className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-blue-500">
              Zminimalizuj do zasobnika
            </button>
            <button type="button" onClick={onQuit} className="w-full rounded-xl border border-red-500/60 bg-red-600/20 px-4 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-600/30">
              Zamknij aplikację
            </button>
            <button type="button" onClick={onCancel} className="w-full rounded-xl border border-slate-600 px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">
              Anuluj
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
