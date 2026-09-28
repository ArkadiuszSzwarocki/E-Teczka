import type { Tag } from '../types/domain';

type Props = {
  isOpen: boolean;
  tags: Tag[];
  name: string;
  color: string;
  onNameChange: (value: string) => void;
  onColorChange: (value: string) => void;
  onCreate: () => void;
  onDelete: (id: number) => void;
  onClose: () => void;
};

export default function TagManagerModal({ isOpen, tags, name, color, onNameChange, onColorChange, onCreate, onDelete, onClose }: Props) {
  if (!isOpen) return null;
  return <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-5 backdrop-blur-sm">
    <section className="w-full max-w-md rounded-xl border border-slate-600 bg-[#1e293b] p-6 shadow-2xl">
      <div className="flex items-center justify-between"><div><h2 className="text-xl font-bold text-white">Tagi dokumentów</h2><p className="mt-1 text-sm text-slate-400">Tagi ułatwiają filtrowanie i opis dokumentów.</p></div><button onClick={onClose} className="text-xl text-slate-400 hover:text-white">×</button></div>
      <div className="mt-5 flex gap-2"><input value={name} onChange={(event) => onNameChange(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && onCreate()} placeholder="Nazwa nowego tagu" className="min-w-0 flex-1 rounded-lg border border-slate-600 bg-[#0f172a] px-3 py-2 text-white" /><input type="color" value={color} onChange={(event) => onColorChange(event.target.value)} className="h-10 w-12 rounded border border-slate-600 bg-[#0f172a] p-1" /><button onClick={onCreate} className="rounded-lg bg-blue-600 px-4 font-bold text-white hover:bg-blue-500">Dodaj</button></div>
      <div className="mt-5 space-y-2">{tags.length ? tags.map((tag) => <div key={tag.id} className="flex items-center gap-2 rounded-lg bg-slate-800 px-3 py-2"><span className="h-3 w-3 rounded-full" style={{ backgroundColor: tag.color }} /><span className="flex-1 text-slate-200">{tag.name}</span><button onClick={() => onDelete(tag.id)} className="text-xs text-red-300 hover:text-red-100">Usuń</button></div>) : <p className="text-sm text-slate-500">Nie utworzono jeszcze tagów.</p>}</div>
    </section>
  </div>;
}
