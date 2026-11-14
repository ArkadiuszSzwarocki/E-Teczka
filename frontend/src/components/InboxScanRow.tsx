import { useState } from 'react';
import type { InboxScan } from './PrinterScannerModal';

export default function InboxScanRow({ scan, busy, canMove, onMove, onRename }: { scan: InboxScan; busy: boolean; canMove: boolean; onMove: (id: string) => void; onRename: (id: string, title: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(scan.title);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!title.trim()) { setError('Wpisz nazwę dokumentu.'); return; }
    setSaving(true); setError('');
    try { await onRename(scan.id, title); setEditing(false); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Nie udało się zmienić nazwy.'); }
    finally { setSaving(false); }
  };
  return <div draggable={!busy && !editing} onDragStart={event => event.dataTransfer.setData('text/plain', scan.id)} className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-700 py-3">
    <div className="min-w-0 flex-1">{editing ? <><label className="sr-only" htmlFor={`scan-title-${scan.id}`}>Nazwa skanu</label><input id={`scan-title-${scan.id}`} autoFocus value={title} maxLength={240} disabled={saving} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void save(); if (event.key === 'Escape' && !saving) setEditing(false); }} className="w-full rounded border border-blue-500 bg-[#111827] px-3 py-2 text-white" />{error && <p role="alert" className="mt-1 text-xs text-red-300">{error}</p>}</> : <p className="break-words font-semibold text-white">{scan.title}</p>}<p className="text-xs text-slate-400">{new Date(scan.createdAt).toLocaleString('pl-PL')}</p></div>
    {editing ? <div className="flex gap-2"><button disabled={saving} onClick={() => { setEditing(false); setError(''); }} className="rounded px-3 py-2 text-slate-300">Anuluj</button><button disabled={saving} onClick={() => void save()} className="rounded bg-blue-600 px-3 py-2 font-semibold text-white disabled:opacity-50">{saving ? 'Zapisywanie…' : 'Zapisz'}</button></div> : <div className="flex gap-2"><button disabled={busy} onClick={() => { setTitle(scan.title); setEditing(true); }} className="rounded border border-slate-500 px-3 py-2 text-slate-200 disabled:opacity-50">Zmień nazwę</button><button disabled={!canMove || busy} onClick={() => onMove(scan.id)} className="rounded border border-blue-500 px-4 py-2 text-blue-300 disabled:opacity-50">Przenieś</button></div>}
  </div>;
}
