import { useFeedbackReport, type FeedbackCategory } from '../hooks/useFeedbackReport';
import ScreenshotEditor from './ScreenshotEditor';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  activeView: string;
  initialScreenshot: string | null;
  initialAppVersion?: string;
  initialPlatform?: string;
  onClose: () => void;
};

const CATEGORIES: Array<{ value: FeedbackCategory; label: string }> = [
  { value: 'bug', label: 'Błąd / Bug' },
  { value: 'feedback', label: 'Uwaga / Pomysł' },
  { value: 'backup', label: 'Kopia zapasowa / Konto' },
  { value: 'other', label: 'Inne' },
];

/** Modal for submitting bug reports and user feedback with screenshots to the QNAP database. */
export default function FeedbackModal({
  apiUrl,
  fetcher,
  activeView,
  initialScreenshot,
  initialAppVersion,
  initialPlatform,
  onClose,
}: Props) {
  const report = useFeedbackReport({
    apiUrl,
    fetcher,
    activeView,
    initialScreenshot,
    initialAppVersion,
    initialPlatform,
  });

  return (
    <div className={report.annotator.pickingLive ? 'hidden' : 'fixed inset-0 z-[125] flex bg-[#0f172a]'} onPaste={report.handlePaste}>
      <section role="dialog" aria-modal="true" aria-labelledby="feedback-modal-title" className="flex h-screen w-screen flex-col overflow-hidden bg-[#0f172a]">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-700 px-6 py-3.5">
          <h2 id="feedback-modal-title" className="text-lg font-bold text-white">Zgłoś błąd lub uwagę</h2>
          <button type="button" aria-label="Zamknij" onClick={onClose} className="rounded-lg px-3 py-1 text-2xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {report.submittedId !== null ? (
            <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-5 text-sm text-emerald-100">
              <p className="font-semibold">Dziękujemy! Zgłoszenie #{report.submittedId} zostało zapisane w bazie na serwerze QNAP.</p>
              <div className="flex justify-end">
                <button type="button" onClick={onClose} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500">Zamknij</button>
              </div>
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
              <div className="flex flex-col gap-4">
                <label className="block text-xs text-slate-300">
                  Kategoria
                  <select value={report.category} onChange={e => report.setCategory(e.target.value as FeedbackCategory)} className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-sm text-white">
                    {CATEGORIES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
                  </select>
                </label>
                <label className="block text-xs text-slate-300">
                  E-mail kontaktowy (opcjonalnie)
                  <input type="email" value={report.contactEmail} onChange={e => report.setContactEmail(e.target.value)} placeholder="np. jan@example.pl" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-sm text-white" />
                </label>
                <label className="block text-xs text-slate-300">
                  Temat
                  <input type="text" maxLength={160} value={report.title} onChange={e => report.setTitle(e.target.value)} placeholder="Krótko opisz problem lub sugestię" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-sm text-white" />
                </label>
                <label className="flex flex-1 flex-col text-xs text-slate-300">
                  Opis
                  <textarea rows={6} maxLength={5000} value={report.description} onChange={e => report.setDescription(e.target.value)} placeholder="Co dokładnie się wydarzyło? Możesz też wkleić zrzut ekranu skrótem Ctrl+V." className="mt-1 w-full flex-1 rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-sm text-white" />
                </label>
                {report.error && <p role="alert" className="rounded-lg border border-red-500/40 bg-red-950/40 p-3 text-xs text-red-200">{report.error}</p>}
                <div className="flex justify-end gap-2 pt-1">
                  <button type="button" onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-slate-300 hover:bg-slate-800">Anuluj</button>
                  <button type="button" disabled={report.submitting} onClick={() => void report.submit()} className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50">
                    {report.submitting ? 'Wysyłanie…' : 'Wyślij zgłoszenie'}
                  </button>
                </div>
              </div>
              <ScreenshotEditor
                imageUrl={report.screenshotDataUrl}
                annotator={report.annotator}
                capturing={report.capturing}
                hasDesktopCapture={report.hasDesktopCapture}
                onCaptureScreen={() => void report.captureScreen()}
                onAttachFile={file => void report.attachFile(file)}
                onClearScreenshot={report.clearScreenshot}
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
