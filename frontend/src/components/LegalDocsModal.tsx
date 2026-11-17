import { useEffect, useState } from 'react';

export type LegalDocId = 'privacy' | 'terms' | 'consents' | 'storage';

type LegalDocItem = {
  id: LegalDocId;
  title: string;
  content: string;
};

type Props = {
  apiUrl: string;
  initialTab?: LegalDocId;
  onClose: () => void;
};

/** Renders Markdown-formatted legal, consent, and data-storage documentation inside the app. */
export default function LegalDocsModal({ apiUrl, initialTab = 'privacy', onClose }: Props) {
  const [docs, setDocs] = useState<LegalDocItem[]>([]);
  const [activeTab, setActiveTab] = useState<LegalDocId>(initialTab);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void fetch(`${apiUrl}/api/legal`)
      .then(async res => {
        if (!res.ok) throw new Error();
        return (await res.json()) as { documents?: LegalDocItem[] };
      })
      .then(data => {
        if (active) setDocs(Array.isArray(data.documents) ? data.documents : []);
      })
      .catch(() => {
        if (active) setError('Nie udało się pobrać dokumentów.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [apiUrl]);

  const currentDoc = docs.find(doc => doc.id === activeTab) ?? docs[0];

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center overflow-y-auto bg-black/85 p-4 backdrop-blur-sm" onClick={onClose}>
      <section role="dialog" aria-modal="true" aria-labelledby="legal-docs-title" className="my-auto flex max-h-[88vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-600 bg-[#0f172a] p-6 text-slate-200 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-700 pb-4">
          <div>
            <h2 id="legal-docs-title" className="text-xl font-bold text-white">Dokumenty prawne, zgody i przechowywanie danych</h2>
            <p className="mt-1 text-xs text-slate-400">Aktualne dokumenty z repozytorium aplikacji E‑Teczka.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="text-2xl text-slate-400 hover:text-white">×</button>
        </div>

        <div className="mt-4 flex flex-wrap gap-2 border-b border-slate-800 pb-3">
          {docs.map(doc => (
            <button
              key={doc.id}
              type="button"
              onClick={() => setActiveTab(doc.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${activeTab === doc.id ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-300 hover:bg-slate-700'}`}
            >
              {doc.title}
            </button>
          ))}
        </div>

        <div className="custom-scrollbar mt-4 flex-1 overflow-y-auto pr-2">
          {loading ? (
            <p className="py-6 text-sm text-slate-400">Ładowanie dokumentów…</p>
          ) : error ? (
            <p className="py-6 text-sm text-red-300">{error}</p>
          ) : currentDoc ? (
            <div className="space-y-2 text-sm leading-6 text-slate-200">
              {currentDoc.content.split(/\r?\n/).map((line, index) => {
                if (line.startsWith('# ')) return <h3 key={index} className="mt-3 text-xl font-bold text-white">{line.slice(2)}</h3>;
                if (line.startsWith('## ')) return <h4 key={index} className="mt-4 border-b border-slate-800 pb-1 text-base font-bold text-blue-300">{line.slice(3)}</h4>;
                if (line.startsWith('### ')) return <h5 key={index} className="mt-3 text-sm font-bold text-emerald-300">{line.slice(4)}</h5>;
                if (line.startsWith('---')) return <hr key={index} className="my-3 border-slate-800" />;
                if (line.startsWith('> ')) return <blockquote key={index} className="rounded border-l-4 border-amber-400 bg-amber-950/20 px-3 py-2 text-xs text-amber-200">{line.slice(2)}</blockquote>;
                if (line.startsWith('- ') || /^\d+\.\s/.test(line)) return <p key={index} className="pl-3 text-slate-300">{line}</p>;
                if (!line.trim()) return <div key={index} className="h-1" />;
                return <p key={index} className="text-slate-300">{line}</p>;
              })}
            </div>
          ) : null}
        </div>
      </section>
    </div>
  );
}
