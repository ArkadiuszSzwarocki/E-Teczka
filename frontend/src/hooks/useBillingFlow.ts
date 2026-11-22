import { useCallback, useEffect, useState } from 'react';
import { confirmCheckout, startCheckout, type BillingDetails, type BillingPlan, type BillingTransaction, type PaidBillingPlan } from '../services/billing';
import { errorMessage } from '../utils/errors';

export type CancelPreview = {
  accessUntil: string;
  refundedAmount: number;
  refundedMonths: number;
  currency: string;
  alreadyScheduled: boolean;
  restrictedDocuments: number;
  inactiveTags: number;
};

type Args = {
  apiUrl: string;
  fetcher: typeof fetch;
  fetchData: () => Promise<void>;
  showToast: (message: string, type?: string) => void;
  closeUserMenu: () => void;
};

/** Manages Stripe checkout, upgrade polling, subscription cancellation preview, and billing history. */
export function useBillingFlow({ apiUrl, fetcher: fetch, fetchData, showToast, closeUserMenu }: Args) {
  const [planLimitMessage, setPlanLimitMessage] = useState('');
  const [billingIsDev, setBillingIsDev] = useState(false);
  const [billingPlan, setBillingPlan] = useState<BillingPlan>('free');
  const [billingDetails, setBillingDetails] = useState<BillingDetails | null>(null);
  const [billingDetailsBusy, setBillingDetailsBusy] = useState(false);
  const [billingBusy, setBillingBusy] = useState(false);
  const [billingCancelBusy, setBillingCancelBusy] = useState(false);
  const [isBillingCancelOpen, setIsBillingCancelOpen] = useState(false);
  const [billingCancelPreview, setBillingCancelPreview] = useState<CancelPreview | null>(null);
  const [billingCancelPreviewError, setBillingCancelPreviewError] = useState('');
  const [billingCancelPreviewBusy, setBillingCancelPreviewBusy] = useState(false);
  const [isBillingHistoryOpen, setIsBillingHistoryOpen] = useState(false);
  const [billingHistory, setBillingHistory] = useState<BillingTransaction[]>([]);
  const [billingHistoryBusy, setBillingHistoryBusy] = useState(false);

  useEffect(() => {
    const handler = (event: Event) => setPlanLimitMessage(String((event as CustomEvent<string>).detail));
    window.addEventListener('eteczka-plan-limit', handler);
    return () => window.removeEventListener('eteczka-plan-limit', handler);
  }, []);

  const openBillingCheckout = useCallback(async (plan: PaidBillingPlan, interval: 'monthly' | 'yearly', acceptReplacement = false, fromLimit = false) => {
    setBillingBusy(true);
    try {
      const checkout = await startCheckout(apiUrl, fetch, plan, interval, acceptReplacement);
      if (checkout.kind === 'upgrade') localStorage.setItem('eteczka_pending_upgrade', String(Date.now()));
      else localStorage.setItem('eteczka_pending_checkout', JSON.stringify({ sessionId: checkout.sessionId, startedAt: Date.now() }));
      window.open(checkout.url, '_blank', 'noopener,noreferrer');
      closeUserMenu();
      showToast('Otworzono bezpieczną stronę płatności Stripe.', 'success');
    } catch (error: unknown) {
      const message = errorMessage(error, 'Nie udało się uruchomić płatności Stripe.');
      if (fromLimit) setPlanLimitMessage(message); else showToast(message, 'error');
    } finally {
      setBillingBusy(false);
    }
  }, [apiUrl, fetch, closeUserMenu, showToast]);

  useEffect(() => {
    let active = true;
    let busy = false;
    const sync = async () => {
      const started = Number(localStorage.getItem('eteczka_pending_upgrade') || 0);
      if (!started || busy) return;
      if (Date.now() - started > 30 * 60 * 1000) { localStorage.removeItem('eteczka_pending_upgrade'); return; }
      busy = true;
      try {
        const response = await fetch(`${apiUrl}/api/billing/sync-upgrade`, { method: 'POST' });
        const result = await response.json();
        if (active && result.upgraded) {
          localStorage.removeItem('eteczka_pending_upgrade');
          await fetchData();
          showToast('Plan Premium jest aktywny.', 'success');
        }
      } catch { /* retry on next focus/interval */ } finally {
        busy = false;
      }
    };
    void sync();
    const timer = window.setInterval(() => void sync(), 10000);
    window.addEventListener('focus', sync);
    return () => { active = false; window.clearInterval(timer); window.removeEventListener('focus', sync); };
  }, [apiUrl, fetch, fetchData, showToast]);

  const loadBillingManageDetails = useCallback(async () => {
    if (billingPlan === 'free') return;
    setBillingDetailsBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/billing/manage`);
      const payload = await response.json().catch(() => null);
      if (response.ok && payload) setBillingDetails(payload as BillingDetails);
    } finally {
      setBillingDetailsBusy(false);
    }
  }, [apiUrl, fetch, billingPlan]);

  const openBillingCancel = useCallback(async () => {
    closeUserMenu();
    setIsBillingCancelOpen(true);
    setBillingCancelPreview(null);
    setBillingCancelPreviewError('');
    setBillingCancelPreviewBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/billing/cancel-preview`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nie udało się obliczyć zwrotu.');
      setBillingCancelPreview(payload);
    } catch (error: unknown) {
      setBillingCancelPreviewError(errorMessage(error, 'Nie udało się obliczyć zwrotu.'));
    } finally {
      setBillingCancelPreviewBusy(false);
    }
  }, [apiUrl, fetch, closeUserMenu]);

  const cancelBilling = useCallback(async () => {
    setBillingCancelBusy(true);
    try {
      const response = await fetch(`${apiUrl}/api/billing/cancel-subscription`, { method: 'POST' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'Nie udało się anulować planu.');
      setBillingDetails(null);
      setIsBillingCancelOpen(false);
      const amount = typeof payload.refundedAmount === 'number' ? (payload.refundedAmount / 100).toFixed(2) : '0.00';
      const months = typeof payload.refundedMonths === 'number' ? payload.refundedMonths : 0;
      const until = payload.accessUntil ? new Date(payload.accessUntil).toLocaleDateString('pl-PL') : 'końca opłaconego miesiąca';
      showToast(months > 0 ? `Odnowienie wyłączone. Dostęp do ${until}. Zwrot ${amount} zł w toku.` : `Odnowienie wyłączone. Dostęp do ${until}.`, 'success');
      await fetchData();
    } catch (error: unknown) {
      showToast(errorMessage(error, 'Nie udało się anulować Premium.'), 'error');
    } finally {
      setBillingCancelBusy(false);
    }
  }, [apiUrl, fetch, fetchData, showToast]);

  const openBillingHistory = useCallback(async () => {
    setBillingHistoryBusy(true);
    setIsBillingHistoryOpen(true);
    try {
      const response = await fetch(`${apiUrl}/api/billing/history`);
      const payload = await response.json().catch(() => []);
      if (!response.ok) throw new Error(payload.error || 'Nie udało się pobrać historii transakcji.');
      setBillingHistory(Array.isArray(payload) ? payload : []);
    } catch (error: unknown) {
      setBillingHistory([]);
      showToast(errorMessage(error, 'Nie udało się pobrać historii transakcji.'), 'error');
    } finally {
      setBillingHistoryBusy(false);
    }
  }, [apiUrl, fetch, showToast]);

  useEffect(() => {
    let confirmingPending = false;
    const confirmPendingCheckout = async () => {
      if (confirmingPending) return;
      const raw = localStorage.getItem('eteczka_pending_checkout');
      if (!raw) return;
      let pending: { sessionId: string; startedAt: number };
      try { pending = JSON.parse(raw); } catch { localStorage.removeItem('eteczka_pending_checkout'); return; }
      if (typeof pending.sessionId !== 'string' || typeof pending.startedAt !== 'number' || Date.now() - pending.startedAt > 60 * 60_000) {
        localStorage.removeItem('eteczka_pending_checkout');
        return;
      }
      confirmingPending = true;
      try {
        await confirmCheckout(apiUrl, fetch, pending.sessionId);
        localStorage.removeItem('eteczka_pending_checkout');
        showToast('Płatność potwierdzona. Plan został aktywowany.', 'success');
        await fetchData();
      } catch { /* retry while session is recent */ } finally {
        confirmingPending = false;
      }
    };
    const params = new URLSearchParams(window.location.search);
    if (params.get('billing') === 'success' && params.get('session_id')) {
      const sessionId = params.get('session_id')!;
      void (async () => {
        try {
          await confirmCheckout(apiUrl, fetch, sessionId);
          window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
          showToast('Płatność potwierdzona. Plan został aktywowany.', 'success');
        } catch (error: unknown) {
          showToast(errorMessage(error, 'Płatność została wykonana, ale potwierdzenie jeszcze trwa.'), 'error');
        } finally {
          await fetchData();
        }
      })();
    }
    const initialFetch = window.setTimeout(() => { void fetchData(); void confirmPendingCheckout(); }, 0);
    const interval = window.setInterval(() => { void fetchData(); }, 5000);
    const pendingInterval = window.setInterval(() => { void confirmPendingCheckout(); }, 10_000);
    return () => {
      window.clearTimeout(initialFetch);
      window.clearInterval(interval);
      window.clearInterval(pendingInterval);
    };
  }, [apiUrl, fetch, fetchData, showToast]);

  return {
    planLimitMessage, setPlanLimitMessage,
    billingIsDev, setBillingIsDev,
    billingPlan, setBillingPlan,
    billingDetails, setBillingDetails, billingDetailsBusy,
    billingBusy, billingCancelBusy,
    isBillingCancelOpen, setIsBillingCancelOpen,
    billingCancelPreview, billingCancelPreviewError, billingCancelPreviewBusy,
    isBillingHistoryOpen, setIsBillingHistoryOpen,
    billingHistory, billingHistoryBusy,
    openBillingCheckout, loadBillingManageDetails, openBillingCancel, cancelBilling, openBillingHistory,
  };
}
