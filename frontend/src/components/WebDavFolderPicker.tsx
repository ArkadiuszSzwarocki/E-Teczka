import { useState } from 'react';
import { AppFolderIcon } from './FolderIconPicker';

type Folder = { name: string; path: string };
type Props = { fetcher: typeof fetch; apiUrl: string; endpoint: string; username: string; password: string; selected: string; onSelect: (path: string) => void; onEndpointChange: (value: string) => void; authHeaders: () => Record<string, string>; disabled: boolean };

export default function WebDavFolderPicker({ apiUrl, endpoint, username, password, selected, onSelect, onEndpointChange, authHeaders, disabled, fetcher: fetch }: Props) {
  const [path, setPath] = useState('');
  const [folders, setFolders] = useState<Folder[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestedEndpoint, setSuggestedEndpoint] = useState('');
  const load = async (next: string, createName?: string) => {
    setBusy(true); setError(''); setSuggestedEndpoint('');
    try {
      const response = await fetch(`${apiUrl}/api/backup/webdav/folders`, { method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint, username, password, folder: next, ...(createName === undefined ? {} : { createName }) }) });
      const result = await response.json();
      if (!response.ok) { if (typeof result.suggestedEndpoint === 'string') setSuggestedEndpoint(result.suggestedEndpoint); throw new Error(result.error || 'Nie udało się pobrać folderów.'); }
      setPath(next); setFolders(result.folders); onSelect(next); if (createName !== undefined) setName('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Nie udało się połączyć z serwerem.'); }
    finally { setBusy(false); }
  };
  return <div className="space-y-2 text-sm text-slate-200">
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" disabled={disabled || busy} onClick={() => void load('')} className="rounded-lg border border-blue-400/70 bg-blue-600/20 px-4 py-2 text-xs font-bold text-blue-200 hover:bg-blue-600/30 disabled:opacity-50">{busy ? 'Łączenie…' : 'Połącz i wybierz folder'}</button>
      {selected && !folders && <span className="text-xs text-slate-400">Zapisany folder: <strong className="text-slate-200">/{selected.replace(/^\/+/, '')}</strong></span>}
    </div>
    {folders && <div className="space-y-2 rounded-lg border border-slate-600 bg-[#0f172a] p-3"><div className="flex flex-wrap items-center justify-between gap-2"><p className="text-xs text-slate-300">Aktualny folder: <strong className="text-white">/{path}</strong></p><div className="flex items-center gap-2">{path && <button type="button" disabled={busy} onClick={() => void load(path.split('/').slice(0, -1).join('/'))} className="rounded border border-slate-500 px-2.5 py-1 text-xs hover:bg-slate-800">↑ Wyżej</button>}<button type="button" disabled={busy} onClick={() => onSelect(path)} className="rounded bg-blue-600 px-3 py-1 text-xs font-bold text-white hover:bg-blue-500">Wybierz ten folder</button></div></div><div className="max-h-44 space-y-1 overflow-y-auto rounded border border-slate-700/80 bg-[#111827] p-1.5">{folders.length ? folders.map(folder => <button type="button" key={folder.path} disabled={busy} onClick={() => void load(folder.path)} className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-xs hover:bg-slate-700/80"><AppFolderIcon size="sm" /> <span>{folder.name}</span></button>) : <p className="p-2 text-xs text-slate-400">Brak podfolderów.</p>}</div><div className="flex gap-2"><input value={name} onChange={event => setName(event.target.value)} placeholder="Nazwa nowego folderu" className="min-w-0 flex-1 rounded border border-slate-600 bg-[#111827] px-2.5 py-1.5 text-xs text-white" /><button type="button" disabled={busy || !name.trim()} onClick={() => void load(path, name)} className="rounded border border-slate-500 px-3 text-xs font-semibold hover:bg-slate-800">Utwórz</button></div><p className="text-xs text-emerald-300">Wybrano: /{selected || '(folder główny)'}</p></div>}
    {error && <p role="alert" className="text-xs text-red-300">{error}</p>}
    {suggestedEndpoint && <button type="button" onClick={() => { onSelect(''); onEndpointChange(suggestedEndpoint); }} className="rounded border border-blue-400 px-3 py-1.5 text-xs">Użyj bezpiecznej nazwy: {suggestedEndpoint}</button>}
  </div>;
}
