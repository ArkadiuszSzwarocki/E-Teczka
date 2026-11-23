import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentRecord, FolderRecord } from '../types/domain';

type QuickAction = {
  id: string;
  label: string;
  icon: string;
  keywords: string;
  run: () => void;
};

type Props = {
  open: boolean;
  documents: DocumentRecord[];
  folders: FolderRecord[];
  billingPlan: string;
  onClose: () => void;
  onOpenDocument: (doc: DocumentRecord) => void;
  onOpenFolder: (folderId: number) => void;
  onNavigate: (view: string) => void;
  onOpenScanner: () => void;
  onOpenIdCardCopy: () => void;
};

/** Global Ctrl+K / Cmd+K Command Palette for instant search across documents, folders, and quick actions. */
export default function CommandPaletteModal({
  open, documents, folders, billingPlan, onClose, onOpenDocument, onOpenFolder, onNavigate, onOpenScanner, onOpenIdCardCopy,
}: Props) {
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    window.setTimeout(() => inputRef.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const actions = useMemo<QuickAction[]>(() => {
    const base: QuickAction[] = [
      { id: 'scan', icon: '📷', label: 'Nowy skan / Skanuj z drukarki', keywords: 'skan skaner drukarka aparat', run: () => { onClose(); onOpenScanner(); } },
      { id: 'upload', icon: '⬆️', label: 'Dodaj dokument lub paragon', keywords: 'dodaj upload plik pdf paragon', run: () => { onClose(); onNavigate('upload'); } },
      { id: 'idcard', icon: '🪪', label: 'Bezpieczna kopia dowodu / karty (A4 + znak wodny)', keywords: 'dowod karta kopia znak wodny rodo', run: () => { onClose(); onOpenIdCardCopy(); } },
      { id: 'expiry', icon: '🗓️', label: 'Kalendarz ważności i Teczka Awaryjna', keywords: 'kalendarz polisa oc przeglad gwarancja awaryjna', run: () => { onClose(); onNavigate('expiry-calendar'); } },
      { id: 'analytics', icon: '📊', label: 'Podsumowanie, inflacja koszyka i podwyżki', keywords: 'analizy wydatki inflacja podwyzki ksiegowa', run: () => { onClose(); onNavigate('analytics'); } },
      { id: 'mail', icon: '📧', label: 'Poczta (Załączniki IMAP)', keywords: 'poczta mail imap faktury', run: () => { onClose(); onNavigate('mail-inbox'); } },
    ];
    if (billingPlan === 'business') {
      base.push({ id: 'ksef', icon: '🏛️', label: 'KSeF — Pobierz faktury z API MF', keywords: 'ksef mf faktury jdg', run: () => { onClose(); onNavigate('ksef-sync'); } });
    }
    return base;
  }, [billingPlan, onClose, onNavigate, onOpenIdCardCopy, onOpenScanner]);

  if (!open) return null;

  const q = query.trim().toLowerCase();
  const matchedActions = actions.filter(a => !q || a.label.toLowerCase().includes(q) || a.keywords.includes(q));
  const matchedFolders = q ? folders.filter(f => f.name.toLowerCase().includes(q)).slice(0, 6) : [];
  const matchedDocs = q
    ? documents.filter(d => !d.isDeleted && (
      d.title.toLowerCase().includes(q)
      || (d.merchantName && d.merchantName.toLowerCase().includes(q))
      || (typeof d.amountCents === 'number' && (d.amountCents / 100).toFixed(2).includes(q.replace(',', '.')))
    )).slice(0, 8)
    : [];

  return (
    <div className="fixed inset-0 z-[160] flex items-start justify-center bg-black/70 p-4 pt-20 backdrop-blur-sm" onClick={onClose}>
      <section role="dialog" aria-modal="true" onClick={e => e.stopPropagation()} className="w-full max-w-xl overflow-hidden rounded-2xl border border-slate-600 bg-[#0f172a] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-slate-700 px-4 py-3">
          <span className="text-slate-400">🔍</span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Szukaj dokumentów, kartotek, kwot lub wpisz akcję… (Esc zamknij)"
            className="w-full bg-transparent text-sm text-white placeholder:text-slate-500 focus:outline-none"
          />
          <kbd className="rounded border border-slate-600 bg-slate-800 px-1.5 py-0.5 text-[10px] font-bold text-slate-400">ESC</kbd>
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-2 space-y-3">
          {matchedActions.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Szybkie akcje</p>
              {matchedActions.map(action => (
                <button key={action.id} type="button" onClick={action.run} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-blue-600/20 hover:text-white">
                  <span>{action.icon}</span>
                  <span>{action.label}</span>
                </button>
              ))}
            </div>
          )}

          {matchedFolders.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Kartoteki</p>
              {matchedFolders.map(folder => (
                <button key={folder.id} type="button" onClick={() => { onClose(); onOpenFolder(folder.id); }} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs font-semibold text-slate-200 hover:bg-blue-600/20 hover:text-white">
                  <span>📁</span>
                  <span>{folder.name}</span>
                </button>
              ))}
            </div>
          )}

          {matchedDocs.length > 0 && (
            <div>
              <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-500">Dokumenty</p>
              {matchedDocs.map(doc => (
                <button key={doc.id} type="button" onClick={() => { onClose(); onOpenDocument(doc); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-xs text-slate-200 hover:bg-blue-600/20 hover:text-white">
                  <span className="truncate font-semibold">📄 {doc.title}</span>
                  {typeof doc.amountCents === 'number' && <span className="shrink-0 font-mono text-blue-300">{(doc.amountCents / 100).toFixed(2)} {doc.currency || 'PLN'}</span>}
                </button>
              ))}
            </div>
          )}

          {q && matchedActions.length === 0 && matchedFolders.length === 0 && matchedDocs.length === 0 && (
            <p className="px-3 py-6 text-center text-xs text-slate-400">Brak wyników dla „{query}”.</p>
          )}
        </div>
      </section>
    </div>
  );
}
