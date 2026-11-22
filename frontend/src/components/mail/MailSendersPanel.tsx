import { useMemo, useState } from 'react';
import type { FolderRecord } from '../../types/domain';
import type { SenderFilterEntry } from '../../types/mailInbox';
import { buildFolderTreeEntries } from '../../utils/folderTree';

type Props = {
  senders: SenderFilterEntry[];
  folders: FolderRecord[];
  canAssign: boolean;
  defaultExpanded?: boolean;
  onToggleExclusion: (email: string, excluded: boolean) => Promise<void>;
  onAssignFolder: (email: string, folderId: number | null) => Promise<void>;
};

/** Collapsible panel showing senders with attachments, email/@domain scan exclusions, and auto-folder rules. */
export function MailSendersPanel({ senders, folders, canAssign, defaultExpanded = false, onToggleExclusion, onAssignFolder }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [excludeInput, setExcludeInput] = useState('');
  const [targetFolderInput, setTargetFolderInput] = useState('');

  const assignedCount = senders.filter(s => Boolean(s.folderId)).length;
  const treeFolders = useMemo(() => buildFolderTreeEntries(folders), [folders]);
  const query = excludeInput.trim().toLowerCase();
  const isListVisible = expanded || query.length > 0;
  const visibleSenders = query ? senders.filter(s => s.email.toLowerCase().includes(query)) : senders;
  const isDirectRule = query.includes('@') && query.includes('.');
  const matchedTargets = !isDirectRule && query.length > 0
    ? (targetFolderInput ? visibleSenders.filter(s => !s.excluded) : visibleSenders)
    : [];

  const handleApplyRule = async () => {
    const val = excludeInput.trim();
    if (!val) return;
    if (isDirectRule) {
      if (targetFolderInput) {
        await onAssignFolder(val, Number(targetFolderInput));
        setExcludeInput('');
        setTargetFolderInput('');
      } else {
        await onToggleExclusion(val, true);
        setExcludeInput('');
      }
      return;
    }
    if (matchedTargets.length === 0) return;
    for (const sender of matchedTargets) {
      if (targetFolderInput) {
        await onAssignFolder(sender.email, Number(targetFolderInput));
      } else {
        await onToggleExclusion(sender.email, true);
      }
    }
    setExcludeInput('');
    if (targetFolderInput) setTargetFolderInput('');
  };

  return (
    <section className="rounded-xl border border-slate-700 bg-[#1e293b] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="flex items-center gap-2 text-left text-xs font-bold uppercase tracking-wider text-slate-200 hover:text-cyan-300"
        >
          <span>{isListVisible ? '▾' : '▸'} Nadawcy z załącznikami, wykluczenia i auto‑kartoteki</span>
          <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] font-normal normal-case text-slate-300">
            Aktywni: {senders.filter(s => !s.excluded).length} · Wykluczeni: {senders.filter(s => s.excluded).length} · Auto‑kartoteki: {assignedCount}
          </span>
        </button>
        <form
          onSubmit={e => {
            e.preventDefault();
            void handleApplyRule();
          }}
          className="flex flex-wrap items-center gap-1.5"
        >
          <input
            value={excludeInput}
            onChange={e => setExcludeInput(e.target.value)}
            placeholder="Adres lub @domena (np. @olx.pl)"
            className={`w-52 rounded-lg border px-2.5 py-1 text-xs placeholder-slate-500 transition focus:border-cyan-400 focus:outline-none ${
              query
                ? 'border-cyan-400 bg-cyan-950/45 text-cyan-100 ring-2 ring-cyan-400/50 shadow-[0_0_12px_rgba(34,211,238,0.25)]'
                : 'border-slate-600 bg-[#0f172a] text-white'
            }`}
          />
          {canAssign && (
            <select
              value={targetFolderInput}
              onChange={e => setTargetFolderInput(e.target.value)}
              className="max-w-[160px] rounded-lg border border-slate-600 bg-[#0f172a] px-2 py-1 text-xs text-slate-200"
              title="Opcjonalnie przypisz ten adres do kartoteki"
            >
              <option value="">Omiń przy skanie</option>
              {treeFolders.map(({ folder, depth }) => (
                <option key={folder.id} value={folder.id}>
                  {`${'\u00A0\u00A0\u00A0'.repeat(depth)}${depth > 0 ? '↳ 📁 ' : '📂 '}${folder.name}`}
                </option>
              ))}
            </select>
          )}
          <button
            type="submit"
            disabled={!query || (!isDirectRule && matchedTargets.length === 0)}
            className={`rounded-lg border px-2.5 py-1 text-xs font-semibold disabled:opacity-40 ${targetFolderInput
              ? 'border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
              : 'border-amber-500/50 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25'
              }`}
          >
            {targetFolderInput
              ? `📁 Przypisz${matchedTargets.length > 0 ? ` (${matchedTargets.length})` : ''}`
              : `＋ Omiń${matchedTargets.length > 0 ? ` (${matchedTargets.length})` : ''}`}
          </button>
        </form>
      </div>

      {isListVisible && (
        <div className="mt-3 border-t border-slate-700/80 pt-3">
          {visibleSenders.length === 0 ? (
            <p className="text-xs text-slate-400">
              {query ? 'Brak pasujących nadawców na liście (możesz od razu kliknąć „＋ Omiń” lub „📁 Przypisz”).' : 'Brak nadawców z załącznikami lub wykluczonych adresów.'}
            </p>
          ) : (
            <div className="max-h-[60vh] space-y-1.5 overflow-y-auto pr-1">
              {visibleSenders.map(sender => (
                <div
                  key={sender.email}
                  className={`flex flex-col gap-1.5 rounded-lg border px-3 py-2 text-xs transition ${
                    sender.excluded
                      ? 'border-red-500/30 bg-red-950/20 text-slate-400'
                      : 'border-slate-700 bg-[#0f172a]/70 text-slate-200 hover:border-cyan-500/50'
                  }`}
                >
                  <label className="flex cursor-pointer items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={!sender.excluded}
                        onChange={e => void onToggleExclusion(sender.email, !e.target.checked)}
                        className="h-4 w-4 shrink-0 accent-cyan-500"
                      />
                      <span className={`truncate ${sender.excluded ? 'line-through' : ''}`} title={sender.email}>{sender.email}</span>
                    </span>
                    <span className="shrink-0 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                      {sender.excluded ? 'pomijany' : `${sender.pendingCount}`}
                    </span>
                  </label>
                  {!sender.excluded && (
                    <select
                      disabled={!canAssign}
                      value={sender.folderId ?? ''}
                      onChange={e => void onAssignFolder(sender.email, e.target.value ? Number(e.target.value) : null)}
                      title={canAssign ? 'Automatyczna kartoteka dla nowych załączników od tego nadawcy' : 'Wymaga planu Standard lub Premium'}
                      className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] text-slate-300 disabled:opacity-50"
                    >
                      <option value="">📥 Do poczekalni (ręcznie)</option>
                      {treeFolders.map(({ folder, depth }) => (
                        <option key={folder.id} value={folder.id}>
                          {`${'\u00A0\u00A0\u00A0'.repeat(depth)}${depth > 0 ? '↳ 📁 ' : '📂 '}${folder.name}`}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
