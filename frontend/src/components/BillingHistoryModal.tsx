type BillingTransaction = {
  id: number;
  type: string;
  status: string;
  amount: number;
  currency: string;
  description?: string | null;
  occurredAt: string;
};

type Props = {
  transactions: BillingTransaction[];
  loading: boolean;
  onClose: () => void;
};

export default function BillingHistoryModal({ transactions, loading, onClose }: Props) {
  return <div className="fixed inset-0 z-[105] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"><div className="w-full max-w-2xl rounded-2xl border border-slate-600 bg-[#0f172a] p-6 shadow-2xl"><div className="flex items-center justify-between"><h3 className="text-xl font-bold text-white">Historia transakcji</h3><button onClick={onClose} className="text-2xl text-slate-400 hover:text-white">×</button></div>{loading ? <p className="py-10 text-center text-slate-400">Pobieranie historii…</p> : transactions.length === 0 ? <p className="py-10 text-center text-slate-400">Brak transakcji.</p> : <div className="mt-5 max-h-80 overflow-y-auto rounded-lg border border-slate-700"><table className="w-full text-left text-sm"><thead className="sticky top-0 bg-[#1e293b] text-xs uppercase text-slate-400"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3">Opis</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Kwota</th></tr></thead><tbody>{transactions.map((transaction) => <tr key={transaction.id} className="border-t border-slate-700"><td className="whitespace-nowrap px-4 py-3 text-slate-400">{new Date(transaction.occurredAt).toLocaleString('pl-PL')}</td><td className="px-4 py-3 text-slate-200">{transaction.description || (transaction.type === 'refund' ? 'Zwrot' : 'Płatność')}</td><td className={`px-4 py-3 font-semibold ${transaction.type === 'refund' ? 'text-emerald-300' : 'text-blue-300'}`}>{transaction.type === 'refund' ? 'Zwrot' : transaction.status === 'succeeded' ? 'Opłacono' : transaction.status}</td><td className={`px-4 py-3 text-right font-mono font-bold ${transaction.type === 'refund' ? 'text-emerald-300' : 'text-slate-200'}`}>{transaction.type === 'refund' ? '+' : ''}{(transaction.amount / 100).toFixed(2)} {transaction.currency.toUpperCase()}</td></tr>)}</tbody></table></div>}<div className="mt-5 flex justify-end"><button onClick={onClose} className="rounded-lg bg-slate-700 px-5 py-2 font-semibold text-white hover:bg-slate-600">Zamknij</button></div></div></div>;
}
