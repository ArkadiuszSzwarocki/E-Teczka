export type BillingPlan = 'free' | 'standard' | 'premium';

export type BillingTransaction = {
  id: number;
  type: string;
  status: string;
  amount: number;
  currency: string;
  description?: string | null;
  occurredAt: string;
};

export type BillingDetails = {
  plan: BillingPlan;
  status: string;
  interval?: 'month' | 'year' | null;
  intervalCount?: number;
  amount?: number;
  currency?: string;
  renewalAt?: string | null;
  cancellationPolicy?: string;
  cancellationScheduled?: boolean;
  developmentOverride?: boolean;
};

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function getBillingStatus(apiUrl: string, fetcher: Fetcher): Promise<BillingDetails | null> {
  const response = await fetcher(`${apiUrl}/api/billing/status`);
  return response.ok ? await response.json() as BillingDetails : null;
}

export async function startCheckout(apiUrl: string, fetcher: Fetcher, plan: 'standard' | 'premium', interval: 'monthly' | 'yearly', acceptReplacement = false) {
  const response = await fetcher(`${apiUrl}/api/billing/checkout`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan, interval, acceptReplacement }) });
  const payload = await response.json().catch(() => ({})) as { url?: string; sessionId?: string; kind?: string; error?: string };
  if (!response.ok || typeof payload.url !== 'string' || typeof payload.sessionId !== 'string') throw new Error(payload.error || 'Nie udało się uruchomić płatności.');
  return { url: payload.url, sessionId: payload.sessionId, kind: payload.kind };
}

export async function confirmCheckout(apiUrl: string, fetcher: Fetcher, sessionId: string) {
  const response = await fetcher(`${apiUrl}/api/billing/confirm?session_id=${encodeURIComponent(sessionId)}`);
  if (!response.ok) throw new Error('Nie udało się potwierdzić płatności.');
}
