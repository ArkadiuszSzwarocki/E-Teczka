import express from 'express';
import Stripe from 'stripe';
import type { PrismaClient } from '@prisma/client';
import { billingReturnBase } from '../services/billingReturnUrl';
import { devPlan } from '../services/devPlans';
import { prepareCentralOffline, centralOwner } from '../services/centralPlanLedger';
import { getPlanUsage } from '../services/planUsage';
import { centralEntitlement, hasCentralLink, centralPlanRequest, centralDeviceRegistered } from '../services/centralEntitlements';
import { ocrOwnerKey } from '../services/ocrPremium';
import { getCatalog, quote, applyCentralCatalog } from '../services/planCatalog';
import { centralAccountOrigin } from '../services/centralAccountLink';
import {
  applyCheckoutSession,
  BillingHttpError,
  cancelStripeSubscription,
  defaultStripeClient,
  getStripeManageSummary,
  periodEnd,
  permitsReplacement,
  previewStripeCancellation,
  processStripeWebhookEvent,
  recordBillingTransaction,
} from '../services/stripeBilling';

function ownerKey(request: express.Request) {
  return String(request.res?.locals.billingOwnerKey || 'desktop-local');
}

export function createBillingReturnRouter(prisma: PrismaClient, getStripe: () => Stripe | null = defaultStripeClient) {
  const router = express.Router();

  router.get('/confirm', async (request, response) => {
    const stripe = getStripe();
    const sessionId = typeof request.query.session_id === 'string' ? request.query.session_id : '';
    if (!stripe || !sessionId) return response.status(400).send('Brak identyfikatora sesji płatności.');
    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const plan = await applyCheckoutSession(prisma, stripe, session, true);
      const planLabels: Record<string, string> = { standard: 'Standard', premium: 'Premium', family: 'Rodzinny', business: 'Firmowy' };
      const planLabel = (plan && planLabels[plan]) || 'Premium';
      response.type('html').send(`<!doctype html><meta charset="utf-8"><title>MojaTeczka — płatność potwierdzona</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność potwierdzona</h1><p>Plan ${planLabel} jest aktywny. Możesz zamknąć to okno i wrócić do MojejTeczki.</p><script>setTimeout(() => window.close(), 2500)</script></body>`);
    } catch (error) {
      if (error instanceof BillingHttpError) return response.status(error.statusCode).send(error.message);
      response.status(400).send('Nie udało się potwierdzić płatności.');
    }
  });

  router.get('/cancel', (_request, response) => {
    response.type('html').send('<!doctype html><meta charset="utf-8"><title>MojaTeczka — płatność anulowana</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność anulowana</h1><p>Nie pobrano opłaty. Możesz zamknąć tę kartę i wrócić do MojejTeczki.</p></body>');
  });

  router.get('/portal-return', (_request, response) => {
    response.type('html').send('<!doctype html><meta charset="utf-8"><title>MojaTeczka — powrót</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Wróć do MojejTeczki</h1><p>Możesz zamknąć to okno. Aplikacja sprawdzi status subskrypcji.</p></body>');
  });

  return router;
}

let lastCentralCatalogFetchAt = 0;
const CENTRAL_CATALOG_TTL_MS = 5 * 60 * 1000;

export function createBillingRouter(prisma: PrismaClient, getStripe: () => Stripe | null = defaultStripeClient, options: { allowLegacyCheckout?: boolean } = {}) {
  const router = express.Router();

  router.get('/catalog', async (_request, response) => {
    const centralOrigin = centralAccountOrigin(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
    if (centralOrigin && Date.now() - lastCentralCatalogFetchAt > CENTRAL_CATALOG_TTL_MS) {
      lastCentralCatalogFetchAt = Date.now();
      try {
        const res = await fetch(`${centralOrigin}/catalog`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
        if (res.ok) applyCentralCatalog(await res.json());
      } catch { /* Fallback to cached/local catalog when central server is unreachable */ }
    }
    const catalog = getCatalog();
    const now = new Date();
    response.json({
      catalog,
      quotes: {
        standard: { monthly: quote('standard', 'monthly', now, catalog), yearly: quote('standard', 'yearly', now, catalog) },
        premium: { monthly: quote('premium', 'monthly', now, catalog), yearly: quote('premium', 'yearly', now, catalog) },
        family: { monthly: quote('family', 'monthly', now, catalog), yearly: quote('family', 'yearly', now, catalog) },
        business: { monthly: quote('business', 'monthly', now, catalog), yearly: quote('business', 'yearly', now, catalog) },
      },
    });
  });

  router.get('/usage', async (_request, response) => {
    try { response.json(await getPlanUsage(prisma, ocrOwnerKey(response), Number(response.locals.userId || 1))); }
    catch (error) { console.error('[billing] Nie udało się pobrać limitów:', error); response.status(500).json({ error: 'Nie udało się pobrać wykorzystania planu.' }); }
  });

  router.post('/offline', async (request, response) => {
    const userId = centralOwner(ocrOwnerKey(response));
    if (!userId) return response.status(400).json({ error: 'Zaloguj się na konto MojejTeczki, aby pobrać przydział offline.' });
    try {
      if (request.body?.budgets !== undefined && (typeof request.body.budgets !== 'object' || request.body.budgets === null || Array.isArray(request.body.budgets))) throw new Error('Nieprawidłowe przydziały offline.');
      await centralEntitlement(userId, true);
      return response.json(await prepareCentralOffline(prisma, userId, request.body?.budgets));
    } catch (error) { return response.status(409).json({ error: (error as Error).message }); }
  });

  router.get('/status', async (request, response) => {
    const override = devPlan(ownerKey(request));
    if (override) return response.json({ plan: override, status: override === 'free' ? 'inactive' : 'active', developmentOverride: true, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    const centralId = /^user:(\d+)$/.exec(ownerKey(request));
    const central = centralId ? await centralEntitlement(Number(centralId[1])) : null;
    if (central) return response.json({ plan: central.plan, status: central.plan === 'free' ? 'inactive' : 'active', currentPeriodEnd: central.validUntil ? new Date(central.validUntil) : null, cancelAtPeriodEnd: false, source: 'central', offlineUntil: central.expiresAt ? new Date(central.expiresAt) : null, deviceBlocked: central.blocked });
    if (centralId && await hasCentralLink(prisma, Number(centralId[1]))) return response.json({ plan: 'free', status: 'inactive', source: 'central', registrationRequired: true });
    const subscription = await prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
    const scheduledEndPassed = Boolean(subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd && subscription.currentPeriodEnd <= new Date());
    if (scheduledEndPassed && subscription && subscription.status !== 'canceled') {
      await prisma.subscription.update({ where: { ownerKey: subscription.ownerKey }, data: { plan: 'free', status: 'canceled' } });
    }
    const active = !scheduledEndPassed && (subscription?.status === 'active' || subscription?.status === 'trialing');
    const resolvedLocalPlan = subscription?.plan && ['standard', 'premium', 'family', 'business'].includes(subscription.plan) ? subscription.plan : 'premium';
    response.json({
      plan: active ? resolvedLocalPlan : 'free',
      status: scheduledEndPassed ? 'canceled' : subscription?.status ?? 'inactive',
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    });
  });

  router.get('/manage', async (request, response) => {
    const override = devPlan(ownerKey(request));
    if (override) return response.json({ plan: override, status: override === 'free' ? 'inactive' : 'active', developmentOverride: true });
    const centralId = /^user:(\d+)$/.exec(ownerKey(request));
    const central = centralId ? await centralEntitlement(Number(centralId[1])) : null;
    if (central) return response.json({ plan: central.plan, status: central.plan === 'free' ? 'inactive' : 'active', source: 'central', renewalAt: central.validUntil ? new Date(central.validUntil) : null });
    const key = ownerKey(request);
    const localSubscription = await prisma.subscription.findUnique({ where: { ownerKey: key } });
    const active = localSubscription?.status === 'active' || localSubscription?.status === 'trialing';
    if (!active || !localSubscription?.providerSubscriptionId) return response.json({ plan: 'free', status: localSubscription?.status || 'inactive' });
    const stripe = getStripe();
    if (!stripe) return response.json({ plan: localSubscription.plan, status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
    try { return response.json(await getStripeManageSummary(stripe, key, localSubscription)); }
    catch (error) {
      if (error instanceof BillingHttpError) return response.status(error.statusCode).json({ error: error.message });
      return response.json({ plan: localSubscription.plan, status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
    }
  });

  router.get('/cancel-preview', async (request, response) => {
    const user = /^user:(\d+)$/.exec(ownerKey(request));
    if (user && centralDeviceRegistered(Number(user[1]))) return response.status(409).json({ error: 'Plan konta jest zarządzany centralnie. Subskrypcję Google Play możesz zmienić lub anulować w Google Play.', managementUrl: 'https://play.google.com/store/account/subscriptions' });
    if (devPlan(ownerKey(request))) return response.status(409).json({ error: 'W trybie testu planu wyłącz go przed zmianą płatności Stripe.' });
    const key = ownerKey(request);
    const local = await prisma.subscription.findUnique({ where: { ownerKey: key } });
    if (!local?.providerSubscriptionId || !['active', 'trialing'].includes(local.status)) return response.status(404).json({ error: 'Brak aktywnej subskrypcji.' });
    const stripe = getStripe();
    if (!stripe) return response.status(503).json({ error: 'Płatności nie są skonfigurowane.' });
    try { return response.json(await previewStripeCancellation(prisma, stripe, key, Number(response.locals.userId || 1), local.providerSubscriptionId)); }
    catch (error) {
      if (error instanceof BillingHttpError) return response.status(error.statusCode).json({ error: error.message });
      return response.status(503).json({ error: 'Nie udało się pobrać rozliczenia ze Stripe.' });
    }
  });

  router.post('/cancel-subscription', async (request, response) => {
    const user = /^user:(\d+)$/.exec(ownerKey(request));
    if (user && centralDeviceRegistered(Number(user[1]))) return response.status(409).json({ error: 'Subskrypcję Google Play anulujesz w Google Play. Serwer kont odświeży uprawnienia po zmianie.', managementUrl: 'https://play.google.com/store/account/subscriptions' });
    if (devPlan(ownerKey(request))) return response.status(409).json({ error: 'W trybie testu planu wyłącz go przed zmianą płatności Stripe.' });
    const stripe = getStripe();
    if (!stripe) return response.status(503).json({ error: 'Płatności nie są skonfigurowane.' });
    const key = ownerKey(request);
    const localSubscription = await prisma.subscription.findUnique({ where: { ownerKey: key } });
    if (!localSubscription?.providerSubscriptionId) return response.status(404).json({ error: 'Nie znaleziono subskrypcji.' });
    try { return response.json(await cancelStripeSubscription(prisma, stripe, key, localSubscription.providerSubscriptionId, localSubscription.plan)); }
    catch (error) {
      if (error instanceof BillingHttpError) return response.status(error.statusCode).json({ error: error.message });
      return response.status(500).json({ error: error instanceof Error ? error.message : 'Nie udało się anulować subskrypcji.' });
    }
  });

  router.get('/history', async (request, response) => {
    const key = ownerKey(request);
    const user = /^user:(\d+)$/.exec(key);
    if (user && centralDeviceRegistered(Number(user[1]))) {
      try { return response.json(await centralPlanRequest(Number(user[1]), '/billing/history')); }
      catch { return response.status(503).json({ error: 'Historia konta jest chwilowo niedostępna na serwerze.' }); }
    }
    let transactions = await prisma.billingTransaction.findMany({ where: { ownerKey: key }, orderBy: { occurredAt: 'desc' }, take: 100 });
    if (transactions.length === 0) {
      const localSubscription = await prisma.subscription.findUnique({ where: { ownerKey: key } });
      const stripe = getStripe();
      if (stripe && localSubscription?.providerSubscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(localSubscription.providerSubscriptionId, { expand: ['latest_invoice'] });
          const invoice = typeof subscription.latest_invoice === 'object' && subscription.latest_invoice ? subscription.latest_invoice : null;
          if (invoice && typeof invoice.id === 'string') {
            await recordBillingTransaction(prisma, { ownerKey: key, providerReference: invoice.id, providerSubscriptionId: subscription.id, type: 'subscription_payment', status: invoice.status === 'paid' ? 'succeeded' : String(invoice.status || 'open'), amount: invoice.amount_paid || 0, currency: invoice.currency, description: 'Subskrypcja MojaTeczka Premium' });
            transactions = await prisma.billingTransaction.findMany({ where: { ownerKey: key }, orderBy: { occurredAt: 'desc' }, take: 100 });
          }
        } catch {}
      }
    }
    response.json(transactions);
  });

  router.post('/sync-upgrade', async (request, response) => {
    if (devPlan(ownerKey(request))) return response.status(409).json({ error: 'Wyłącz test planu przed zmianą subskrypcji.' });
    const stripe = getStripe();
    const existing = await prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
    if (!stripe || !existing?.providerSubscriptionId || !existing.providerCustomerId) return response.status(404).json({ error: 'Nie znaleziono subskrypcji.' });
    try {
      const subscription = await stripe.subscriptions.retrieve(existing.providerSubscriptionId);
      const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
      const price = subscription.items.data[0]?.price?.id;
      const priceToPlan: Array<[string | undefined, 'premium' | 'family' | 'business']> = [
        [process.env.STRIPE_PRICE_MONTHLY, 'premium'],
        [process.env.STRIPE_PRICE_YEARLY, 'premium'],
        [process.env.STRIPE_FAMILY_PRICE_MONTHLY, 'family'],
        [process.env.STRIPE_FAMILY_PRICE_YEARLY, 'family'],
        [process.env.STRIPE_BUSINESS_PRICE_MONTHLY, 'business'],
        [process.env.STRIPE_BUSINESS_PRICE_YEARLY, 'business'],
      ];
      const matchedPlan = price ? priceToPlan.find(([id]) => id === price)?.[1] : undefined;
      if (subscription.metadata?.ownerKey !== ownerKey(request) || customer !== existing.providerCustomerId || !['active', 'trialing'].includes(subscription.status) || !matchedPlan) return response.json({ upgraded: false });
      const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id;
      if (!invoiceId || (await stripe.invoices.retrieve(invoiceId)).status !== 'paid') return response.json({ upgraded: false });
      await prisma.subscription.updateMany({ where: { ownerKey: ownerKey(request), providerSubscriptionId: subscription.id }, data: { plan: matchedPlan, status: subscription.status, currentPeriodEnd: periodEnd(subscription.items.data[0]?.current_period_end), cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) } });
      return response.json({ upgraded: true, plan: matchedPlan });
    } catch { return response.status(503).json({ error: 'Nie udało się potwierdzić zmiany planu w Stripe.' }); }
  });

  router.post('/checkout', async (request, response) => {
    if (!options.allowLegacyCheckout) return response.status(503).json({ code: 'GOOGLE_PLAY_PENDING', error: 'Zakupy przez Google Play są w przygotowaniu. Nowe płatności Stripe są wyłączone.' });
    if (devPlan(ownerKey(request))) return response.status(409).json({ error: 'W trybie testu planu wyłącz go przed zmianą płatności Stripe.' });
    const stripe = getStripe();
    if (!stripe) return response.status(503).json({ error: 'Płatności testowe nie są jeszcze skonfigurowane.' });

    const planOrder: Record<string, number> = { free: 0, standard: 1, premium: 2, family: 3, business: 4 };
    const requestedPlan = String(request.body?.plan || 'premium');
    const existing = await prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
    const isActiveUpgrade = existing && ['active', 'trialing'].includes(existing.status) && !existing.cancelAtPeriodEnd
      && (planOrder[requestedPlan] ?? 0) > (planOrder[existing.plan] ?? 0);
    if (isActiveUpgrade) {
      const upgradePrices: Record<string, { monthly?: string; yearly?: string }> = {
        premium: { monthly: process.env.STRIPE_PRICE_MONTHLY, yearly: process.env.STRIPE_PRICE_YEARLY },
        family: { monthly: process.env.STRIPE_FAMILY_PRICE_MONTHLY, yearly: process.env.STRIPE_FAMILY_PRICE_YEARLY },
        business: { monthly: process.env.STRIPE_BUSINESS_PRICE_MONTHLY, yearly: process.env.STRIPE_BUSINESS_PRICE_YEARLY },
      };
      const price = request.body?.interval === 'yearly' ? upgradePrices[requestedPlan]?.yearly : upgradePrices[requestedPlan]?.monthly;
      if (!price || !existing.providerSubscriptionId || !existing.providerCustomerId) return response.status(503).json({ error: 'Zmiana planu wymaga skonfigurowanej ceny docelowego planu i aktywnej subskrypcji Stripe.' });
      try {
        const subscription = await stripe.subscriptions.retrieve(existing.providerSubscriptionId);
        const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
        if (subscription.metadata?.ownerKey !== ownerKey(request) || customer !== existing.providerCustomerId || subscription.items.data.length !== 1 || !['active', 'trialing'].includes(subscription.status)) return response.status(409).json({ error: 'Nie można bezpiecznie potwierdzić obecnej subskrypcji.' });
        const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${billingReturnBase(request.socket.localAddress)}/api/billing/portal-return`, flow_data: { type: 'subscription_update_confirm', subscription_update_confirm: { subscription: subscription.id, items: [{ id: subscription.items.data[0].id, price, quantity: subscription.items.data[0].quantity || 1 }] } } });
        return response.json({ url: portal.url, sessionId: '', kind: 'upgrade' });
      } catch (error) { console.error('[billing] Nie udało się przygotować zmiany planu:', error instanceof Error ? error.message : 'Stripe error'); return response.status(503).json({ error: 'Nie udało się przygotować zmiany planu w Stripe. Sprawdź konfigurację portalu klienta i ceny planów.' }); }
    }
    try { if (!await permitsReplacement(stripe, existing, ownerKey(request))) return response.status(409).json({ error: 'Masz aktywną subskrypcję bez zaplanowanego anulowania.' }); }
    catch { return response.status(503).json({ error: 'Nie udało się sprawdzić anulowania w Stripe. Spróbuj ponownie.' }); }
    if (existing?.cancelAtPeriodEnd && ['active', 'trialing'].includes(existing.status) && request.body?.acceptReplacement !== true) return response.status(409).json({ error: 'Przed nową płatnością potwierdź rozpoczęcie nowego planu i opłatę za niego.' });

    const rawPlan = String(request.body?.plan || '');
    if (!['standard', 'premium', 'family', 'business'].includes(rawPlan)) {
      return response.status(400).json({ error: 'Nieprawidłowa nazwa planu.' });
    }
    const plan = rawPlan as 'standard' | 'premium' | 'family' | 'business';
    const interval = request.body?.interval === 'yearly' ? 'yearly' : 'monthly';
    const envPrices: Record<typeof plan, { monthly?: string; yearly?: string; fallbackMonthly: number; fallbackYearly: number; label: string }> = {
      standard: { monthly: process.env.STRIPE_STANDARD_PRICE_MONTHLY, yearly: process.env.STRIPE_STANDARD_PRICE_YEARLY, fallbackMonthly: 499, fallbackYearly: 4990, label: 'Standard' },
      premium: { monthly: process.env.STRIPE_PRICE_MONTHLY, yearly: process.env.STRIPE_PRICE_YEARLY, fallbackMonthly: 999, fallbackYearly: 9990, label: 'Premium' },
      family: { monthly: process.env.STRIPE_FAMILY_PRICE_MONTHLY, yearly: process.env.STRIPE_FAMILY_PRICE_YEARLY, fallbackMonthly: 1499, fallbackYearly: 14990, label: 'Rodzinny' },
      business: { monthly: process.env.STRIPE_BUSINESS_PRICE_MONTHLY, yearly: process.env.STRIPE_BUSINESS_PRICE_YEARLY, fallbackMonthly: 2999, fallbackYearly: 29990, label: 'Firmowy' },
    };
    const planCfg = envPrices[plan];
    const price = interval === 'yearly' ? planCfg.yearly : planCfg.monthly;
    const testKey = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');
    if (!price && !testKey) return response.status(503).json({ error: `Brak ceny dla planu ${planCfg.label} (${interval}).` });

    const quotedAmount = quote(plan, interval).amount;
    const fallbackAmount = quotedAmount > 0 ? quotedAmount : (interval === 'yearly' ? planCfg.fallbackYearly : planCfg.fallbackMonthly);
    const lineItem = price ? { price, quantity: 1 } : { price_data: { currency: 'pln', unit_amount: fallbackAmount, recurring: { interval: interval === 'yearly' ? 'year' as const : 'month' as const }, product_data: { name: `MojaTeczka ${planCfg.label}` } }, quantity: 1 };
    const returnBase = billingReturnBase(request.socket.localAddress);
    const replacesSubscriptionId = existing?.cancelAtPeriodEnd && ['active', 'trialing'].includes(existing.status) ? existing.providerSubscriptionId || '' : '';
    const checkoutParams = { mode: 'subscription', line_items: [lineItem], success_url: process.env.ETECZKA_BILLING_SUCCESS_URL || `${returnBase}/api/billing/confirm?session_id={CHECKOUT_SESSION_ID}`, cancel_url: process.env.ETECZKA_BILLING_CANCEL_URL || `${returnBase}/api/billing/cancel`, metadata: { ownerKey: ownerKey(request), plan, replacesSubscriptionId }, subscription_data: { metadata: { ownerKey: ownerKey(request), plan } } } as Stripe.Checkout.SessionCreateParams & { managed_payments?: { enabled: boolean } };
    checkoutParams.managed_payments = { enabled: false };
    const session = await stripe.checkout.sessions.create(checkoutParams);
    return response.json({ url: session.url, sessionId: session.id });
  });

  return router;
}

export function createBillingWebhookHandler(prisma: PrismaClient, getStripe: () => Stripe | null = defaultStripeClient) {
  return async (request: express.Request, response: express.Response) => {
    const stripe = getStripe();
    const signature = request.header('stripe-signature');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !signature || !secret) return response.status(503).json({ error: 'Webhook Stripe nie jest skonfigurowany.' });

    let event: Stripe.Event;
    try { event = stripe.webhooks.constructEvent(request.body as Buffer, signature, secret); }
    catch { return response.status(400).json({ error: 'Nieprawidłowy podpis webhooka Stripe.' }); }

    try {
      await processStripeWebhookEvent(prisma, stripe, event);
      return response.json({ received: true });
    } catch {
      return response.status(503).json({ error: 'Nie udało się sprawdzić subskrypcji.' });
    }
  };
}
