import { useState } from 'react';

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
  return <div className="mt-3 rounded-lg border border-slate-600 p-3 text-sm text-slate-200">
    <p>Wpisz adres IP lub nazwę serwera. Możesz podać własny port i ścieżkę, np. https://nas.local:5001/webdav. Połączenie używa HTTPS. Otwarcie folderu wybiera go jako miejsce zapisu kopii.</p>
    <button type="button" disabled={disabled || busy} onClick={() => void load('')} className="mt-2 rounded border border-blue-400 px-3 py-2">{busy ? 'Łączenie…' : 'Połącz i wybierz folder'}</button>
    {folders && <div className="mt-3 space-y-2"><p>Aktualny folder: /{path}</p><button type="button" disabled={busy} onClick={() => onSelect(path)} className="rounded bg-blue-600 px-3 py-2">Wybierz ten folder</button>{path && <button type="button" disabled={busy} onClick={() => void load(path.split('/').slice(0, -1).join('/'))} className="ml-2 rounded border border-slate-500 px-3 py-2">↑ Wyżej</button>}<div className="max-h-40 overflow-y-auto">{folders.length ? folders.map(folder => <button type="button" key={folder.path} disabled={busy} onClick={() => void load(folder.path)} className="block w-full rounded p-2 text-left hover:bg-slate-700">📁 {folder.name}</button>) : <p>Brak podfolderów.</p>}</div><div className="flex gap-2"><input value={name} onChange={event => setName(event.target.value)} placeholder="Nazwa nowego folderu" className="min-w-0 flex-1 rounded border border-slate-600 bg-[#111827] p-2" /><button type="button" disabled={busy || !name.trim()} onClick={() => void load(path, name)} className="rounded border border-slate-500 px-3">Utwórz</button></div><p>Wybrano: /{selected || '(folder główny)'}</p></div>}
    {error && <p role="alert" className="mt-2 text-red-300">{error}</p>}
    {suggestedEndpoint && <button type="button" onClick={() => { onSelect(''); onEndpointChange(suggestedEndpoint); }} className="mt-2 rounded border border-blue-400 px-3 py-2">Użyj bezpiecznej nazwy: {suggestedEndpoint}</button>}
  </div>;
}
