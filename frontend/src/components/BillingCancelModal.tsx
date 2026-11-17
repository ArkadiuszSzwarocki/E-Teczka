type CancelPreview = {
  accessUntil: string;
  refundedMonths: number;
  refundedAmount: number;
  currency: string;
  restrictedDocuments: number;
  inactiveTags: number;
  alreadyScheduled: boolean;
};

type Props = {
  previewBusy: boolean;
  previewError: string;
  preview: CancelPreview | null;
  cancelBusy: boolean;
  onClose: () => void;
  onConfirm: () => void;
};

/** Confirmation dialog showing refund estimate and consequences of cancelling a subscription. */
export default function BillingCancelModal({ previewBusy, previewError, preview, cancelBusy, onClose, onConfirm }: Props) {
  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-red-500/40 bg-[#0f172a] p-7 shadow-2xl">
        <h3 className="text-xl font-bold text-white">Anulować subskrypcję?</h3>
        {previewBusy && <p className="mt-3 text-sm text-slate-300">Obliczam rozliczenie…</p>}
        {previewError && <p role="alert" className="mt-3 text-sm text-red-300">{previewError}</p>}
        {preview && (
          <div className="mt-3 space-y-2 text-sm leading-6 text-slate-300">
            <p>Odnowienie zostanie wyłączone. Dostęp do planu pozostanie aktywny do <strong className="text-white">{new Date(preview.accessUntil).toLocaleDateString('pl-PL')}</strong>.</p>
            <p>Zwrot za {preview.refundedMonths} pełnych niewykorzystanych miesięcy: <strong className="text-white">{(preview.refundedAmount / 100).toFixed(2)} {preview.currency.toUpperCase()}</strong>.</p>
            <p className="rounded-lg bg-amber-950/40 p-3 text-amber-100">Po przejściu na plan Darmowy {preview.restrictedDocuments} dokumentów będzie tylko do odczytu, a {preview.inactiveTags} tagów stanie się nieaktywnych. Dokumenty zachowają możliwość pobrania i usunięcia. To szacunkowy stan na teraz.</p>
            {preview.alreadyScheduled && <p className="text-amber-300">Anulowanie zostało już zaplanowane.</p>}
          </div>
        )}
        <div className="mt-6 flex gap-3">
          <button type="button" disabled={cancelBusy} onClick={onClose} className="flex-1 rounded-lg bg-slate-700 py-3 font-bold text-white hover:bg-slate-600 disabled:opacity-50">Wróć</button>
          <button type="button" disabled={cancelBusy || previewBusy || !preview || preview.alreadyScheduled} onClick={onConfirm} className="flex-1 rounded-lg bg-red-600 py-3 font-bold text-white hover:bg-red-500 disabled:opacity-50">
            {cancelBusy ? 'Rozliczanie…' : 'Potwierdź anulowanie'}
          </button>
        </div>
      </div>
    </div>
  );
}
