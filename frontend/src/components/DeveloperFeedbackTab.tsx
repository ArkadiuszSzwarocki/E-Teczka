import { useEffect, useState } from 'react';

type FeedbackStatus = 'new' | 'in_progress' | 'resolved' | 'closed';

type FeedbackThreadMessage = { id: string; author: 'user' | 'admin'; text: string; createdAt: number };

type FeedbackItem = {
  id: number;
  accountEmail: string | null;
  contactEmail: string | null;
  category: string;
  title: string;
  description: string;
  appVersion: string | null;
  platform: string | null;
  activeView: string | null;
  screenshotDataUrl: string | null;
  status: FeedbackStatus;
  createdAt: number;
  messages?: FeedbackThreadMessage[];
};

type Props = {
  apiUrl: string;
  onStatus: (message: string) => void;
  onOpenCountChange?: (count: number) => void;
  onAdminReplyCountChange?: (count: number) => void;
};

const STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'Nowe',
  in_progress: 'W trakcie',
  resolved: 'Rozwiązane',
  closed: 'Zamknięte',
};

const countUserReplies = (list: FeedbackItem[]) =>
  list.filter(item => item.status !== 'closed' && item.messages?.at(-1)?.author === 'user').length;

/** Developer panel tab displaying user bug reports and screenshots stored in MariaDB on QNAP. */
export default function DeveloperFeedbackTab({ apiUrl, onStatus, onOpenCountChange, onAdminReplyCountChange }: Props) {
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [filter, setFilter] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [replyDrafts, setReplyDrafts] = useState<Record<number, string>>({});

  const sendReply = async (id: number) => {
    const text = (replyDrafts[id] || '').trim();
    if (text.length < 2) return;
    try {
      const response = await fetch(`${apiUrl}/api/dev/feedback/${id}/reply`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      const payload = await response.json().catch(() => ({})) as { message?: FeedbackThreadMessage; error?: string };
      if (!response.ok || !payload.message) throw new Error(payload.error || 'Nie udało się wysłać pytania.');
      setItems(prev => {
        const next = prev.map(item => (item.id === id ? { ...item, messages: [...(item.messages || []), payload.message!] } : item));
        if (!filter) onAdminReplyCountChange?.(countUserReplies(next));
        return next;
      });
      setReplyDrafts(prev => ({ ...prev, [id]: '' }));
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Błąd wysyłania pytania.');
    }
  };

  const load = async (statusFilter = filter) => {
    setLoading(true);
    try {
      const query = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : '';
      const response = await fetch(`${apiUrl}/api/dev/feedback${query}`);
      const payload = await response.json().catch(() => ({})) as { items?: FeedbackItem[]; error?: string };
      if (!response.ok) throw new Error(payload.error || 'Nie udało się pobrać zgłoszeń z QNAP-a.');
      const loaded = payload.items || [];
      setItems(loaded);
      if (!statusFilter) {
        onOpenCountChange?.(loaded.filter(item => item.status !== 'closed').length);
        onAdminReplyCountChange?.(countUserReplies(loaded));
      }
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Błąd pobierania zgłoszeń.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(filter); }, [filter]);

  const updateStatus = async (id: number, status: FeedbackStatus) => {
    try {
      const response = await fetch(`${apiUrl}/api/dev/feedback/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Nie udało się zaktualizować statusu.');
      setItems(prev => {
        const next = prev.map(item => (item.id === id ? { ...item, status } : item));
        if (!filter) {
          onOpenCountChange?.(next.filter(item => item.status !== 'closed').length);
        } else {
          void fetch(`${apiUrl}/api/dev/feedback`)
            .then(r => (r.ok ? r.json() : null))
            .then((all: { items?: FeedbackItem[] } | null) => {
              if (all?.items) onOpenCountChange?.(all.items.filter(item => item.status !== 'closed').length);
            })
            .catch(() => undefined);
        }
        return next;
      });
    } catch (error) {
      onStatus(error instanceof Error ? error.message : 'Błąd aktualizacji statusu.');
    }
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-700 bg-slate-900 p-4">
        <div className="flex items-center gap-3">
          <label className="text-xs text-slate-400">
            Status:
            <select value={filter} onChange={e => setFilter(e.target.value)} className="ml-2 rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 text-sm text-white">
              <option value="">Wszystkie</option>
              {(Object.keys(STATUS_LABELS) as FeedbackStatus[]).map(key => (
                <option key={key} value={key}>{STATUS_LABELS[key]}</option>
              ))}
            </select>
          </label>
        </div>
        <button type="button" onClick={() => void load(filter)} className="rounded-lg border border-slate-600 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800">Odśwież z QNAP</button>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Wczytywanie zgłoszeń z bazy QNAP…</p>
      ) : items.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-700 p-8 text-center text-sm text-slate-400">Brak zgłoszeń dla wybranego filtra.</p>
      ) : (
        <div className="space-y-4">
          {items.map(item => (
            <article key={item.id} className="rounded-2xl border border-slate-700 bg-slate-900 p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                    <span className="font-mono text-amber-300">#{item.id}</span>
                    <span className="rounded bg-slate-800 px-2 py-0.5 uppercase text-slate-200">{item.category}</span>
                    <span>{new Date(item.createdAt).toLocaleString('pl-PL')}</span>
                    {item.activeView && <span>widok: {item.activeView}</span>}
                    {item.messages?.at(-1)?.author === 'user' && (
                      <span className="rounded-full border border-amber-400/50 bg-amber-500/20 px-2.5 py-0.5 font-semibold text-amber-300">💬 Odpowiedź użytkownika</span>
                    )}
                    {item.platform && <span>{item.platform}{item.appVersion ? ` v${item.appVersion}` : ''}</span>}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold text-white">{item.title}</h3>
                  {(item.contactEmail || item.accountEmail) && (
                    <p className="mt-1 text-xs text-slate-400">Kontakt: {item.contactEmail || item.accountEmail}</p>
                  )}
                </div>
                <select value={item.status} onChange={e => void updateStatus(item.id, e.target.value as FeedbackStatus)} className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-1.5 text-xs font-semibold text-white">
                  {(Object.keys(STATUS_LABELS) as FeedbackStatus[]).map(key => (
                    <option key={key} value={key}>{STATUS_LABELS[key]}</option>
                  ))}
                </select>
              </div>
              <p className="mt-3 whitespace-pre-wrap text-sm text-slate-200">{item.description}</p>
              {item.screenshotDataUrl && (
                <button type="button" onClick={() => setPreviewUrl(item.screenshotDataUrl)} className="mt-4 block overflow-hidden rounded-lg border border-slate-700 hover:border-blue-400">
                  <img src={item.screenshotDataUrl} alt={`Zrzut do zgłoszenia #${item.id}`} className="max-h-48 object-contain bg-black/50" />
                </button>
              )}
              {item.messages && item.messages.length > 0 && (
                <div className="mt-4 space-y-2 border-t border-slate-800 pt-3">
                  {item.messages.map(msg => (
                    <div key={msg.id} className={`rounded-lg px-3 py-2 text-xs ${msg.author === 'admin' ? 'border border-amber-500/40 bg-amber-950/30 text-amber-100' : 'border border-slate-700 bg-slate-800/70 text-slate-200'}`}>
                      <p className="font-semibold">{msg.author === 'admin' ? 'Admin' : 'Użytkownik'} · {new Date(msg.createdAt).toLocaleString('pl-PL')}</p>
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
                  placeholder="Dopytaj zgłaszającego o szczegóły…"
                  className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-white"
                />
                <button type="button" onClick={() => void sendReply(item.id)} className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-bold text-slate-950 hover:bg-amber-400">
                  Wyślij pytanie
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {previewUrl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-6" onClick={() => setPreviewUrl(null)}>
          <img src={previewUrl} alt="Powiększony zrzut ekranu" className="max-h-full max-w-full rounded-lg border border-slate-600" />
        </div>
      )}
    </section>
  );
}
