import type { ReactNode } from 'react';
import type { WiaDevice } from '../services/electron';
import type { PrinterPage } from '../services/scannerApi';
import InboxScanRow from './InboxScanRow';

export type InboxScan = { id: string; title: string; createdAt: string };
type Props = {
  devices: WiaDevice[]; loadingDevices: boolean; deviceId: string; folderId: string; folderOptions: ReactNode;
  pages: PrinterPage[]; title: string; retentionValue: number; retentionUnit: 'years' | 'months' | 'days'; retentionEnabled: boolean;
  stage: string; busy: boolean; pendingScan: boolean; inbox: InboxScan[];
  onDeviceChange: (value: string) => void; onFolderChange: (value: string) => void; onTitleChange: (value: string) => void;
  onRetentionValueChange: (value: number) => void; onRetentionUnitChange: (value: 'years' | 'months' | 'days') => void; onRetentionEnabledChange: (value: boolean) => void;
  onScan: () => void; onRemovePage: (index: number) => void; onSave: () => void; onMove: (id: string) => void; onRename: (id: string, title: string) => Promise<void>; onClose: () => void;
};

export default function PrinterScannerModal(p: Props) {
  return <section className="w-full max-w-5xl space-y-5 pb-10">
    <div className="flex items-center justify-between"><div><h2 className="text-2xl font-bold text-white">Skanowanie z drukarki</h2><p className="mt-1 text-sm text-slate-400">Dodaj strony, zapisz jeden PDF i przenieś go później do kartoteki.</p></div><button onClick={p.onClose} disabled={p.busy} className="rounded border border-slate-600 px-4 py-2 text-slate-200">Wróć</button></div>
    <div className="space-y-4 rounded-xl border border-slate-700 bg-[#1e293b] p-6">
      <label className="block text-sm font-semibold text-slate-200">Skaner<select value={p.deviceId} disabled={p.busy} onChange={e => p.onDeviceChange(e.target.value)} className="mt-2 w-full rounded border border-slate-600 bg-[#111827] p-3 text-white"><option value="">{p.loadingDevices ? 'Wyszukiwanie…' : 'Wybierz skaner'}</option>{p.devices.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
      <label className="block text-sm font-semibold text-slate-200">Nazwa dokumentu PDF<input value={p.title} disabled={p.busy} onChange={e => p.onTitleChange(e.target.value)} maxLength={240} className="mt-2 w-full rounded border border-slate-600 bg-[#111827] p-3 text-white" /></label>
      <div className="rounded border border-blue-500/30 bg-blue-500/10 p-3 text-sm text-blue-200" role="status">{p.stage || 'Gotowe do skanowania'}</div>
      <div><h3 className="mb-2 font-semibold text-white">Strony dokumentu: {p.pages.length}/20</h3><div className="flex gap-3 overflow-x-auto">{p.pages.map((page, index) => <div key={index} className="relative shrink-0 rounded border border-slate-600 bg-[#111827] p-2"><img src={page.dataUrl} alt={`Strona ${index + 1}`} className="h-40 w-28 object-contain" /><p className="text-center text-xs text-slate-300">{index + 1}</p><button disabled={p.busy} onClick={() => p.onRemovePage(index)} aria-label={`Usuń stronę ${index + 1}`} className="absolute right-1 top-1 rounded bg-red-900 px-2 text-white">×</button></div>)}</div></div>
      <div className="flex flex-wrap items-center gap-3"><label className="flex gap-2 text-sm text-slate-200"><input type="checkbox" checked={p.retentionEnabled} disabled={p.busy} onChange={e => p.onRetentionEnabledChange(e.target.checked)} /> Termin życia</label><input type="number" min="1" max="999" value={p.retentionValue} disabled={p.busy || !p.retentionEnabled} onChange={e => p.onRetentionValueChange(Number(e.target.value))} className="w-20 rounded bg-[#111827] p-2 text-white" /><select value={p.retentionUnit} disabled={p.busy || !p.retentionEnabled} onChange={e => p.onRetentionUnitChange(e.target.value as Props['retentionUnit'])} className="rounded bg-[#111827] p-2 text-white"><option value="years">lat</option><option value="months">miesięcy</option><option value="days">dni</option></select></div>
      <div className="flex flex-wrap gap-3"><button disabled={p.busy || (!p.deviceId && !p.pendingScan) || p.pages.length >= 20} onClick={p.onScan} className="rounded bg-blue-600 px-4 py-3 font-bold text-white disabled:opacity-50">{p.busy ? 'Pracuję…' : p.pendingScan ? 'Ponów dodanie strony' : p.pages.length ? 'Skanuj kolejną stronę' : 'Skanuj pierwszą stronę'}</button><button disabled={p.busy || !p.pages.length || !p.title.trim() || !Number.isInteger(p.retentionValue) || p.retentionValue < 1} onClick={p.onSave} className="rounded bg-emerald-600 px-4 py-3 font-bold text-white disabled:opacity-50">Zapisz PDF do tymczasowych</button></div>
    </div>
    <div className="rounded-xl border border-slate-700 bg-[#1e293b] p-6"><h3 className="text-lg font-bold text-white">Skanowane — do posortowania ({p.inbox.length})</h3><p className="mt-1 text-sm text-slate-400">Wybierz kartotekę i kliknij Przenieś albo przeciągnij skan na pole kartoteki.</p><select value={p.folderId} onDragOver={e => { if (p.folderId && !p.busy) e.preventDefault(); }} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData("text/plain"); if (id && p.folderId && !p.busy) p.onMove(id); }} onChange={e => p.onFolderChange(e.target.value)} className="my-4 w-full rounded border border-slate-600 bg-[#111827] p-3 text-white"><option value="">— wybierz podkartotekę —</option>{p.folderOptions}</select>{p.inbox.length === 0 && <p className="text-sm text-slate-400">Brak skanów oczekujących na przeniesienie.</p>}{p.inbox.map(scan => <InboxScanRow key={scan.id} scan={scan} busy={p.busy} canMove={Boolean(p.folderId)} onMove={p.onMove} onRename={p.onRename} />)}</div>
  </section>;
}
