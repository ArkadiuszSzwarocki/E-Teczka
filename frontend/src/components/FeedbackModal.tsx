import { useEffect, useState } from 'react';
import { useFeedbackReport, type FeedbackCategory } from '../hooks/useFeedbackReport';
import ScreenshotEditor from './ScreenshotEditor';

type Props = {
  apiUrl: string;
  fetcher: typeof fetch;
  activeView: string;
  initialScreenshot: string | null;
  initialAppVersion?: string;
  initialPlatform?: string;
  unreadReplyCount?: number;
  onHistoryViewed?: () => void;
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
  unreadReplyCount = 0,
  onHistoryViewed,
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
  const [tab, setTab] = useState<'new' | 'history'>(unreadReplyCount > 0 && !initialScreenshot ? 'history' : 'new');
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    if (tab === 'history') {
      void report.loadHistory();
      onHistoryViewed?.();
    }
  }, [tab, report.loadHistory, onHistoryViewed]);

  return (
    <div className={report.annotator.pickingLive ? 'hidden' : 'fixed inset-0 z-[125] flex bg-[#0f172a]'} onPaste={report.handlePaste}>
      <section role="dialog" aria-modal="true" aria-labelledby="feedback-modal-title" className="flex h-screen w-screen flex-col overflow-hidden bg-[#0f172a]">
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-slate-700 px-6 py-3.5">
          <div className="flex items-center gap-4">
            <h2 id="feedback-modal-title" className="text-lg font-bold text-white">Zgłoś błąd lub uwagę</h2>
            <div className="flex gap-1 rounded-lg bg-slate-900 p-1">
              <button type="button" onClick={() => setTab('new')} className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === 'new' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}>Nowe zgłoszenie</button>
              <button type="button" onClick={() => setTab('history')} className={`rounded-md px-3 py-1 text-xs font-semibold ${tab === 'history' ? 'bg-blue-600 text-white' : 'text-slate-300 hover:text-white'}`}>
                Moje zgłoszenia{unreadReplyCount > 0 && <span className="ml-1.5 rounded-full bg-amber-400 px-1.5 py-0.5 text-[10px] font-bold text-slate-950">💬 {unreadReplyCount}</span>}
              </button>
            </div>
          </div>
          <button type="button" aria-label="Zamknij" onClick={onClose} className="rounded-lg px-3 py-1 text-2xl text-slate-400 hover:bg-slate-800 hover:text-white">×</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {tab === 'history' ? (
            <div className="mx-auto max-w-4xl space-y-4">
              {report.historyLoading ? (
                <p className="text-sm text-slate-400">Ładowanie historii zgłoszeń…</p>
              ) : report.history.length === 0 ? (
                <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">Nie wysłano jeszcze żadnych zgłoszeń.</p>
              ) : (
                report.history.map(item => (
                  <article key={item.id} className="rounded-xl border border-slate-700 bg-slate-900/70 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2 text-xs text-slate-400">
                        <span className="font-mono text-amber-300">#{item.id}</span>
                        <span className="rounded bg-slate-800 px-2 py-0.5 uppercase text-slate-200">{item.category}</span>
                        <span>{new Date(item.createdAt).toLocaleString('pl-PL')}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {item.messages.at(-1)?.author === 'admin' && <span className="rounded-full bg-amber-500/20 border border-amber-400/50 px-2.5 py-0.5 text-[11px] font-bold text-amber-300">💬 Odpowiedź zespołu</span>}
                        <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-xs font-semibold text-blue-300">{item.status}</span>
                      </div>
                    </div>
                    <h3 className="mt-2 font-semibold text-white">{item.title}</h3>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-slate-300">{item.description}</p>
                    {item.messages.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-slate-800 pt-3">
                        {item.messages.map(msg => (
                          <div key={msg.id} className={`rounded-lg px-3 py-2 text-xs ${msg.author === 'admin' ? 'border border-amber-500/40 bg-amber-950/30 text-amber-100' : 'border border-slate-700 bg-slate-800/70 text-slate-200'}`}>
                            <p className="font-semibold">{msg.author === 'admin' ? 'Administrator (pytanie / odpowiedź)' : 'Ty'} · {new Date(msg.createdAt).toLocaleString('pl-PL')}</p>
                            <p className="mt-1 whitespace-pre-wrap">{msg.text}</p>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="mt-3 flex gap-2">
                      <input
                        type="text"
                        value={replyDrafts[item.id] || ''}
                        onChange={e => setReplyDrafts(prev => ({ ...prev, [item.id]: e.target.value }))}
                        placeholder="Odpowiedz administratorowi lub dopisz szczegóły…"
                        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const text = (replyDrafts[item.id] || '').trim();
                          if (text.length < 2) return;
                          void report.replyToHistory(item.id, text).then(() => setReplyDrafts(prev => ({ ...prev, [item.id]: '' })));
                        }}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-500"
                      >
                        Wyślij
                      </button>
                    </div>
                  </article>
                ))
              )}
            </div>
          ) : report.submittedId !== null ? (
            <div className="mx-auto max-w-xl space-y-4 rounded-xl border border-emerald-500/40 bg-emerald-950/30 p-5 text-sm text-emerald-100">
              <p className="font-semibold">Dziękujemy! Zgłoszenie #{report.submittedId} zostało zapisane w bazie na serwerze QNAP.</p>
              <div className="rounded-lg border border-emerald-500/30 bg-slate-950/60 p-4 text-xs text-slate-200">
                <p className="font-semibold text-white">Czy wysłać kopię tego zgłoszenia na Twój adres e-mail?</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <input
                    type="email"
                    value={report.copyEmail}
                    onChange={e => report.setCopyEmail(e.target.value)}
                    placeholder="twoj@email.pl"
                    className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-xs text-white"
                  />
                  <button
                    type="button"
                    disabled={report.emailCopyBusy}
                    onClick={() => void report.sendEmailCopy()}
                    className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                  >
                    {report.emailCopyBusy ? 'Wysyłanie…' : '✉️ Wyślij kopię na e-mail'}
                  </button>
                </div>
                {report.emailCopyStatus && <p className="mt-2 text-xs text-amber-200">{report.emailCopyStatus}</p>}
              </div>
              <div className="flex flex-wrap justify-between gap-2">
                <button type="button" onClick={() => setTab('history')} className="rounded-lg border border-slate-600 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-800">Zobacz historię zgłoszeń</button>
                <div className="flex gap-2">
                  <button type="button" onClick={report.resetSubmitted} className="rounded-lg border border-emerald-500/40 px-4 py-2 text-xs font-semibold text-emerald-200 hover:bg-emerald-900/30">Nowe zgłoszenie</button>
                  <button type="button" onClick={onClose} className="rounded-lg bg-emerald-600 px-4 py-2 font-semibold text-white hover:bg-emerald-500">Zamknij</button>
                </div>
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
                  Imię zgłaszającego (wymagane)
                  <input type="text" maxLength={80} value={report.reporterName} onChange={e => report.setReporterName(e.target.value)} placeholder="np. Arkadiusz" className="mt-1 w-full rounded-lg border border-slate-600 bg-slate-900 p-2.5 text-sm text-white" />
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
