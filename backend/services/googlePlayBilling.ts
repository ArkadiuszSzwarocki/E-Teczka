export type GooglePlayVerifyInput = {
  packageName: string;
  subscriptionId: string;
  purchaseToken: string;
};

export type GooglePlayVerifyResult = {
  active: boolean;
  expiryTimeMillis: number | null;
  orderId: string | null;
};

/**
 * Verifies a Google Play subscription purchase token via Android Publisher API v3.
 * Requires ETECZKA_GOOGLE_PLAY_ACCESS_TOKEN (or a custom verifyFetch in tests).
 */
export async function verifyGooglePlaySubscription(
  input: GooglePlayVerifyInput,
  accessToken = process.env.ETECZKA_GOOGLE_PLAY_ACCESS_TOKEN || '',
  request: typeof fetch = fetch
): Promise<GooglePlayVerifyResult> {
  if (!input.packageName || !input.subscriptionId || !input.purchaseToken) {
    throw new Error('INVALID_PURCHASE_INPUT');
  }
  if (!accessToken) {
    throw new Error('GOOGLE_PLAY_NOT_CONFIGURED');
  }
  const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(input.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`;
  const response = await request(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
    redirect: 'error',
    signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw new Error('GOOGLE_PLAY_VERIFY_FAILED');
  const payload = await response.json() as {
    subscriptionState?: string;
    latestOrderId?: string;
    lineItems?: Array<{ expiryTime?: string }>;
  };
  const active = payload.subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE' || payload.subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';
  const expiryIso = payload.lineItems?.[0]?.expiryTime;
  const expiryTimeMillis = expiryIso ? Date.parse(expiryIso) : null;
  return {
    active,
    expiryTimeMillis: Number.isFinite(expiryTimeMillis) ? expiryTimeMillis : null,
    orderId: payload.latestOrderId ?? null
  };
}
