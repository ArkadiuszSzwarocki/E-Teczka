import { useEffect, useMemo, useRef, useState } from 'react';
import type { FolderRecord } from '../../types/domain';
import { buildFolderTreeEntries } from '../../utils/folderTree';

type Props = {
  folders: FolderRecord[];
  value: number | '';
  disabled?: boolean;
  placeholder?: string;
  placement?: 'top' | 'bottom';
  onChange: (folderId: number) => void;
};

/** Searchable hierarchical folder picker dropdown with A-Z tree sorting and live filtering. */
export function FolderSearchPicker({ folders, value, disabled, placeholder = 'Wybierz kartotekę…', placement = 'top', onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  const treeEntries = useMemo(() => buildFolderTreeEntries(folders), [folders]);
  const selected = useMemo(() => treeEntries.find(e => e.folder.id === value), [treeEntries, value]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? treeEntries.filter(e => e.pathLabel.toLowerCase().includes(q)) : treeEntries;
  }, [treeEntries, query]);

  useEffect(() => {
    if (!open) return;
    const onOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [open]);

  const panelPosClass = placement === 'bottom' ? 'top-full mt-1' : 'bottom-full mb-1';

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => { setOpen(v => !v); setQuery(''); }}
        className="flex max-w-[230px] items-center justify-between gap-1.5 rounded-lg border border-slate-600 bg-[#0f172a] px-2.5 py-1.5 text-xs text-slate-200 hover:border-cyan-400 disabled:opacity-40"
        title={selected ? `Wybrana kartoteka: ${selected.pathLabel}` : placeholder}
      >
        <span className="truncate">{selected ? `📁 ${selected.pathLabel}` : placeholder}</span>
        <span className="text-[10px] text-slate-400">▾</span>
      </button>

      {open && (
        <div className={`absolute left-0 z-40 w-72 rounded-xl border border-slate-600 bg-[#0f172a] p-2 shadow-2xl ${panelPosClass}`}>
          <input
            type="search"
            autoFocus
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Szukaj kartoteki lub podkartoteki…"
            aria-label="Szukaj kartoteki"
            className={`mb-1.5 w-full rounded-lg border px-2.5 py-1 text-xs placeholder-slate-500 transition focus:border-cyan-400 focus:outline-none ${
              query.trim()
                ? 'border-cyan-400 bg-cyan-950/45 text-cyan-100 ring-2 ring-cyan-400/50'
                : 'border-slate-700 bg-slate-900 text-white'
            }`}
          />
          <div className="max-h-56 space-y-0.5 overflow-y-auto pr-1">
            {filtered.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-slate-400">Brak pasującej kartoteki.</p>
            ) : (
              filtered.map(({ folder, depth, pathLabel }) => (
                <button
                  key={folder.id}
                  type="button"
                  title={pathLabel}
                  onClick={() => { onChange(folder.id); setOpen(false); setQuery(''); }}
                  style={!query.trim() && depth > 0 ? { paddingLeft: `${8 + Math.min(depth, 4) * 18}px` } : undefined}
                  className={`flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                    folder.id === value
                      ? 'bg-emerald-600/30 font-semibold text-emerald-200'
                      : !query.trim() && depth > 0
                        ? 'border-l-2 border-cyan-500/40 text-slate-300 hover:bg-slate-800 hover:text-white'
                        : 'font-medium text-slate-100 hover:bg-slate-800'
                  }`}
                >
                  {query.trim() ? (
                    <span className="truncate">📁 {pathLabel}</span>
                  ) : (
                    <span className="truncate">{depth > 0 ? '↳ 📁 ' : '📂 '}{folder.name}</span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
