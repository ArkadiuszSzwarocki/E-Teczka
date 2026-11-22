import type { MailSyncProgress } from '../../hooks/useMailSync';

type Props = {
  progress: MailSyncProgress;
};

function formatEta(seconds?: number | null): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  if (seconds < 60) return `ok. ${seconds} s`;
  const mins = Math.floor(seconds / 60);
  const rem = seconds % 60;
  return rem > 0 ? `ok. ${mins} min ${rem} s` : `ok. ${mins} min`;
}

/** Displays live dual progress bars for mailbox scanning and attachment downloading. */
export function MailSyncProgressPanel({ progress }: Props) {
  const etaText = formatEta(progress.etaSeconds);
  const scanPct = progress.totalMessages > 0
    ? Math.min(100, Math.round((progress.scannedMessages / progress.totalMessages) * 100))
    : 15;
  const downloadPct = progress.candidateMessages > 0
    ? Math.min(100, Math.round((progress.processedCandidates / progress.candidateMessages) * 100))
    : 0;

  return (
    <section className="space-y-3 rounded-xl border border-cyan-500/40 bg-[#0f172a]/90 p-4 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-bold text-cyan-300">
          {progress.phase === 'connecting' && '🔌 Łączenie ze skrzynką…'}
          {progress.phase === 'scanning' && '🔍 Etap 1/2: Skanowanie wiadomości i liczenie załączników'}
          {progress.phase === 'downloading' && '⬇️ Etap 2/2: Pobieranie i klasyfikacja załączników na żywo'}
          {progress.phase === 'done' && '✅ Zakończono'}
        </span>
        <div className="flex flex-wrap items-center gap-2 text-slate-300">
          {etaText && (
            <span className="rounded bg-cyan-950/60 px-2 py-0.5 text-[11px] font-semibold text-cyan-200 border border-cyan-500/30">
              ⏱️ Pozostało: {etaText}
            </span>
          )}
          <span>{progress.message}</span>
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-slate-400">
          <span>1. Przeskanowane wiadomości</span>
          <span>
            {progress.totalMessages > 0
              ? `${progress.scannedMessages} / ${progress.totalMessages} (${scanPct}%)`
              : 'Przygotowanie…'}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-300"
            style={{ width: `${scanPct}%` }}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex justify-between text-[11px] text-slate-400">
          <span>2. Pobieranie załączników (znaleziono maili: {progress.candidateMessages})</span>
          <span>
            {progress.candidateMessages > 0 && progress.phase !== 'scanning'
              ? `${progress.processedCandidates} / ${progress.candidateMessages} (${downloadPct}%)`
              : progress.phase === 'scanning'
                ? `Oczekiwanie na koniec etapu 1 (znaleziono: ${progress.candidateMessages})…`
                : 'Oczekiwanie na etap 1…'}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-300"
            style={{ width: `${downloadPct}%` }}
          />
        </div>
      </div>
    </section>
  );
}
