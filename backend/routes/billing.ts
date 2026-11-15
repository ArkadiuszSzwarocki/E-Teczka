import express from 'express';
import Stripe from 'stripe';
import type { PrismaClient } from '@prisma/client';
import { calculateUnusedMonthsRefund, paidAccessEndsAt } from '../services/refundPolicy';
import { billingReturnBase } from '../services/billingReturnUrl';
import { devPlan } from '../services/devPlans';
import { getPlanUsage } from '../services/planUsage';
import { ocrOwnerKey } from '../services/ocrPremium';
import { prepareTags, tagIds } from '../services/tagOwnership';
import { PLAN_LIMITS } from '../services/planPolicy';

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

function ownerKey(request: express.Request) {
  return String(request.res?.locals.billingOwnerKey || 'desktop-local');
}

function periodEnd(unixSeconds: number | null | undefined) {
  return typeof unixSeconds === 'number' && unixSeconds > 0 ? new Date(unixSeconds * 1000) : null;
}

type PriorSubscription = { providerSubscriptionId: string | null; status: string; cancelAtPeriodEnd: boolean } | null;
async function permitsReplacement(stripe: Stripe, current: PriorSubscription, owner: string, replacesId?: string | null): Promise<boolean> {
  if (!current || !['active', 'trialing'].includes(current.status)) return true;
  if (!current.cancelAtPeriodEnd || !current.providerSubscriptionId || (replacesId !== undefined && replacesId !== current.providerSubscriptionId)) return false;
  const previous = await stripe.subscriptions.retrieve(current.providerSubscriptionId);
  return previous.metadata?.ownerKey === owner && (previous.status === 'canceled' || Boolean(previous.cancel_at || previous.cancel_at_period_end));
}

type PaidInvoiceDetails = {
  invoice: Stripe.Invoice;
  paymentIntentId: string | null;
  amountPaid: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
};

async function paidInvoiceDetails(stripe: Stripe, subscriptionId: string): Promise<PaidInvoiceDetails | null> {
  const invoices = await stripe.invoices.list({ subscription: subscriptionId, status: 'paid', limit: 100 });
  const invoice = invoices.data.find((item) => (item.amount_paid || 0) > 0);
  if (!invoice) return null;

  // Stripe's current Subscription object no longer exposes the billing period.
  // The paid invoice line is the reliable source of the purchased period.
  const line = invoice.lines.data.find((item) => item.period?.start && item.period?.end) || invoice.lines.data[0];
  const payments = await stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 10 });
  const paidPayment = payments.data.find((item) => item.payment.payment_intent || item.payment.charge) || payments.data[0];
  const paymentIntent = paidPayment?.payment.payment_intent;
  const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : paymentIntent?.id || null;

  return {
    invoice,
    paymentIntentId,
    amountPaid: paidPayment?.amount_paid || invoice.amount_paid || 0,
    currency: invoice.currency || 'pln',
    periodStart: periodEnd(line?.period?.start),
    periodEnd: periodEnd(line?.period?.end),
  };
}

async function recordTransaction(prisma: PrismaClient, data: {
  ownerKey: string;
  providerReference: string;
  providerSubscriptionId?: string | null;
  type: string;
  status: string;
  amount: number;
  currency?: string | null;
  description?: string;
}) {
  return prisma.billingTransaction.upsert({
    where: { providerReference: data.providerReference },
    create: { ...data, currency: data.currency || 'pln' },
    update: { status: data.status, amount: data.amount, description: data.description, providerSubscriptionId: data.providerSubscriptionId },
  });
}

export function createBillingRouter(prisma: PrismaClient, getStripe: () => Stripe | null = stripeClient, options: { allowLegacyCheckout?: boolean } = {}) {
  const router = express.Router();

  router.get('/usage', async (_request, response) => {
    try { response.json(await getPlanUsage(prisma, ocrOwnerKey(response), Number(response.locals.userId || 1))); }
    catch (error) { console.error('[billing] Nie udało się pobrać limitów:', error); response.status(500).json({ error: 'Nie udało się pobrać wykorzystania planu.' }); }
  });

  router.get('/status', async (request, response) => {
    const override = devPlan(ownerKey(request)); if (override) return response.json({ plan: override, status: override === 'free' ? 'inactive' : 'active', developmentOverride: true, currentPeriodEnd: null, cancelAtPeriodEnd: false });
    const subscription = await prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
    const scheduledEndPassed = Boolean(subscription?.cancelAtPeriodEnd && subscription.currentPeriodEnd && subscription.currentPeriodEnd <= new Date());
    if (scheduledEndPassed && subscription && subscription.status !== 'canceled') {
      await prisma.subscription.update({ where: { ownerKey: subscription.ownerKey }, data: { plan: 'free', status: 'canceled' } });
    }
    const active = !scheduledEndPassed && (subscription?.status === 'active' || subscription?.status === 'trialing');
    response.json({
      plan: active ? (subscription?.plan === 'standard' ? 'standard' : 'premium') : 'free',
      status: scheduledEndPassed ? 'canceled' : subscription?.status ?? 'inactive',
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    });
  });

  // This route is loaded only when the account menu is opened. Keeping the
  // Stripe request out of /status prevents the desktop's regular refresh from
  // repeatedly calling Stripe.
  router.get('/manage', async (request, response) => {
    const override = devPlan(ownerKey(request)); if (override) return response.json({ plan: override, status: override === 'free' ? 'inactive' : 'active', developmentOverride: true });
    const key = ownerKey(request);
    const localSubscription = await prisma.subscription.findUnique({ where: { ownerKey: key } });
    const active = localSubscription?.status === 'active' || localSubscription?.status === 'trialing';
    if (!active || !localSubscription?.providerSubscriptionId) {
      return response.json({ plan: 'free', status: localSubscription?.status || 'inactive' });
    }

    const stripe = getStripe();
    if (!stripe) return response.json({ plan: localSubscription.plan, status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
    try {
      const subscription = await stripe.subscriptions.retrieve(localSubscription.providerSubscriptionId);
      if (subscription.metadata?.ownerKey !== key) return response.status(403).json({ error: 'Ta subskrypcja nie należy do tego użytkownika.' });
      const item = subscription.items.data[0];
      const details = await paidInvoiceDetails(stripe, subscription.id);
      return response.json({
        plan: localSubscription.plan,
        status: subscription.status,
        interval: item?.price.recurring?.interval || null,
        intervalCount: item?.price.recurring?.interval_count || 1,
        amount: item?.price.unit_amount || details?.amountPaid || 0,
        currency: item?.price.currency || details?.currency || 'pln',
        renewalAt: subscription.cancel_at || subscription.cancel_at_period_end ? periodEnd(subscription.cancel_at || 0) || details?.periodEnd || localSubscription.currentPeriodEnd || null : details?.periodEnd || localSubscription.currentPeriodEnd || null,
        cancellationScheduled: Boolean(subscription.cancel_at || subscription.cancel_at_period_end),
        cancellationPolicy: 'Bieżący rozpoczęty miesiąc jest opłacony. Zwrot obejmuje wyłącznie pełne niewykorzystane miesiące.',
      });
    } catch {
      return response.json({ plan: localSubscription.plan, status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
    }
  });

  router.get('/confirm', async (request, response) => {
    const stripe = getStripe();
    const sessionId = typeof request.query.session_id === 'string' ? request.query.session_id : '';
    if (!stripe || !sessionId) return response.status(400).send('Brak identyfikatora sesji płatności.');

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const sessionOwner = session.metadata?.ownerKey;
      // The success redirect does not carry the original Authorization header.
      // Stripe's signed session metadata is the source of truth for ownership.
      if (!sessionOwner) return response.status(403).send('Sesja płatności nie zawiera właściciela.');
      const currentOwner = sessionOwner;
      if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
        return response.status(402).send('Płatność nie została jeszcze potwierdzona.');
      }

      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
      const customerId = typeof session.customer === 'string' ? session.customer : null;
      if (!subscriptionId) return response.status(409).send('Nie znaleziono subskrypcji dla tej płatności.');
      const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (stripeSubscription.metadata?.ownerKey !== currentOwner || !['active', 'trialing'].includes(stripeSubscription.status)) {
        return response.status(409).send('Subskrypcja nie jest aktywna.');
      }
      const existing = await prisma.subscription.findUnique({ where: { ownerKey: currentOwner } });
      if (existing?.providerSubscriptionId !== subscriptionId && !await permitsReplacement(stripe, existing, currentOwner, session.metadata?.replacesSubscriptionId || null)) {
        return response.status(409).send('Konto ma już inną aktywną subskrypcję.');
      }
      await prisma.subscription.upsert({
        where: { ownerKey: currentOwner },
        create: { ownerKey: currentOwner, providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: session.metadata?.plan === 'standard' ? 'standard' : 'premium', status: stripeSubscription.status },
        update: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: session.metadata?.plan === 'standard' ? 'standard' : 'premium', status: stripeSubscription.status, cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd(stripeSubscription.items.data[0]?.current_period_end) },
      });
      await recordTransaction(prisma, {
        ownerKey: currentOwner,
        providerReference: session.id,
        providerSubscriptionId: subscriptionId,
        type: 'subscription_payment',
        status: 'succeeded',
        amount: session.amount_total || 0,
        currency: session.currency,
        description: 'Subskrypcja E‑Teczka Premium',
      });

      const planLabel = session.metadata?.plan === 'standard' ? 'Standard' : 'Premium';
      response.type('html').send(`<!doctype html><meta charset="utf-8"><title>E‑Teczka — płatność potwierdzona</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność potwierdzona</h1><p>Plan ${planLabel} jest aktywny. Możesz zamknąć to okno i wrócić do E‑Teczki.</p><script>setTimeout(() => window.close(), 2500)</script></body>`);
    } catch {
      response.status(400).send('Nie udało się potwierdzić płatności.');
    }
  });

  router.get('/cancel', (_request, response) => {
    response.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka — płatność anulowana</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność anulowana</h1><p>Nie pobrano opłaty. Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p></body>');
  });
  router.get('/portal-return', (_request, response) => {
    response.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka — powrót</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Wróć do E‑Teczki</h1><p>Możesz zamknąć to okno. Aplikacja sprawdzi status subskrypcji.</p></body>');
  });

  router.get('/cancel-preview', async (request, response) => {
    if (devPlan(ownerKey(request))) return response.status(409).json({ error: 'W trybie testu planu wyłącz go przed zmianą płatności Stripe.' });
    const key = ownerKey(request);
    const local = await prisma.subscription.findUnique({ where: { ownerKey: key } });
    if (!local?.providerSubscriptionId || !['active', 'trialing'].includes(local.status)) return response.status(404).json({ error: 'Brak aktywnej subskrypcji.' });
    const stripe = getStripe();
    if (!stripe) return response.status(503).json({ error: 'Płatności nie są skonfigurowane.' });
    try {
      const subscription = await stripe.subscriptions.retrieve(local.providerSubscriptionId);
      if (subscription.metadata?.ownerKey !== key) return response.status(403).json({ error: 'Ta subskrypcja nie należy do tego użytkownika.' });
      const details = await paidInvoiceDetails(stripe, subscription.id);
      if (!details) return response.status(409).json({ error: 'Nie znaleziono opłaconej faktury.' });
      const now = new Date();
      const accessUntil = periodEnd(subscription.cancel_at || 0) || paidAccessEndsAt(details, now);
      if (!accessUntil) return response.status(409).json({ error: 'Okres subskrypcji już się zakończył.' });
      const estimate = calculateUnusedMonthsRefund(details, now);
      const ownerId = Number(response.locals.userId || 1); await prepareTags(prisma);
      const [documentCount, ownedTags] = await Promise.all([prisma.document.count({ where: { folder: { ownerId } } }), tagIds(prisma, ownerId)]);
      response.json({ accessUntil, refundedAmount: estimate.refundAmount, refundedMonths: estimate.refundedMonths, currency: details.currency, alreadyScheduled: Boolean(subscription.cancel_at || subscription.cancel_at_period_end), restrictedDocuments: Math.max(0, documentCount - PLAN_LIMITS.free.documents!), inactiveTags: Math.max(0, ownedTags.length - PLAN_LIMITS.free.tags!) });
    } catch {
      response.status(503).json({ error: 'Nie udało się pobrać rozliczenia ze Stripe.' });
    }
  });

  router.post('/cancel-subscription', async (request, response) => {
    if (devPlan(ownerKey(request))) return response.status(409).json({ error: 'W trybie testu planu wyłącz go przed zmianą płatności Stripe.' });
    const stripe = getStripe();
    if (!stripe) return response.status(503).json({ error: 'Płatności nie są skonfigurowane.' });
    const key = ownerKey(request);
    const localSubscription = await prisma.subscription.findUnique({ where: { ownerKey: key } });
    const subscriptionId = localSubscription?.providerSubscriptionId;
    if (!subscriptionId) return response.status(404).json({ error: 'Nie znaleziono subskrypcji.' });

    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      // A historical subscription can be refunded only by its owner. This also
      // allows recovery when it was cancelled before the refund code was fixed.
      if (subscription.metadata?.ownerKey !== key) return response.status(403).json({ error: 'Ta subskrypcja nie należy do tego użytkownika.' });
      const details = await paidInvoiceDetails(stripe, subscription.id);
      if (!details) return response.status(409).json({ error: 'Nie znaleziono opłaconej faktury tej subskrypcji.' });
      const now = new Date();
      const { refundedMonths, refundAmount } = calculateUnusedMonthsRefund(details, now);
      const accessUntil = periodEnd(subscription.cancel_at || 0) || paidAccessEndsAt(details, now);
      if (!accessUntil) return response.status(409).json({ error: 'Okres subskrypcji już się zakończył.' });
      const existingRefund = await prisma.billingTransaction.findFirst({
        where: { providerSubscriptionId: subscription.id, type: 'refund', status: { in: ['succeeded', 'pending'] } },
      });

      // Stop renewal first. Stripe keeps the paid part of the current month active.
      if (!subscription.cancel_at && !subscription.cancel_at_period_end && subscription.status !== 'canceled') {
        const endsAtInvoice = details.periodEnd && accessUntil.getTime() >= details.periodEnd.getTime();
        await stripe.subscriptions.update(subscription.id, endsAtInvoice
          ? { cancel_at_period_end: true, proration_behavior: 'none' }
          : { cancel_at: Math.floor(accessUntil.getTime() / 1000), proration_behavior: 'none' });
      }
      await prisma.subscription.update({ where: { ownerKey: key }, data: { cancelAtPeriodEnd: true, currentPeriodEnd: accessUntil } });

      let refundId: string | null = null;
      if (existingRefund) {
        refundId = existingRefund.providerReference;
      } else if (refundAmount > 0) {
        if (!details.paymentIntentId) return response.status(409).json({ error: 'Nie znaleziono płatności do zwrotu.' });
        const refund = await stripe.refunds.create(
          { payment_intent: details.paymentIntentId, amount: refundAmount, reason: 'requested_by_customer' },
          { idempotencyKey: `eteczka-refund-${subscription.id}-${details.invoice.id}` },
        );
        refundId = refund.id;
        await recordTransaction(prisma, {
          ownerKey: key,
          providerReference: refund.id,
          providerSubscriptionId: subscription.id,
          type: 'refund',
          status: refund.status || 'succeeded',
          amount: refundAmount,
          currency: details.currency,
          description: `Zwrot za ${refundedMonths} niewykorzystanych miesięcy.`,
        });
      }

      return response.json({
        plan: localSubscription?.plan,
        accessUntil,
        refundedAmount: existingRefund ? existingRefund.amount : refundAmount,
        refundedMonths,
        refundId,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Nie udało się anulować subskrypcji.';
      return response.status(500).json({ error: message });
    }
  });

  router.get('/history', async (request, response) => {
    const key = ownerKey(request);
    let transactions = await prisma.billingTransaction.findMany({
      where: { ownerKey: key },
      orderBy: { occurredAt: 'desc' },
      take: 100,
    });
    // Backfill a payment created before local transaction history was enabled.
    if (transactions.length === 0) {
      const localSubscription = await prisma.subscription.findUnique({ where: { ownerKey: key } });
      const stripe = getStripe();
      if (stripe && localSubscription?.providerSubscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(localSubscription.providerSubscriptionId, { expand: ['latest_invoice'] });
          const invoice = typeof subscription.latest_invoice === 'object' && subscription.latest_invoice ? subscription.latest_invoice : null;
          if (invoice && typeof invoice.id === 'string') {
            await recordTransaction(prisma, {
              ownerKey: key,
              providerReference: invoice.id,
              providerSubscriptionId: subscription.id,
              type: 'subscription_payment',
              status: invoice.status === 'paid' ? 'succeeded' : String(invoice.status || 'open'),
              amount: invoice.amount_paid || 0,
              currency: invoice.currency,
              description: 'Subskrypcja E‑Teczka Premium',
            });
            transactions = await prisma.billingTransaction.findMany({ where: { ownerKey: key }, orderBy: { occurredAt: 'desc' }, take: 100 });
          }
        } catch {}
      }
    }
    response.json(transactions);
  });

  router.post('/sync-upgrade', async (request, response) => {
    if (devPlan(ownerKey(request))) return response.status(409).json({ error: 'Wyłącz test planu przed zmianą subskrypcji.' });
    const stripe = getStripe(); const existing = await prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
    if (!stripe || !existing?.providerSubscriptionId || !existing.providerCustomerId) return response.status(404).json({ error: 'Nie znaleziono subskrypcji.' });
    try {
      const subscription = await stripe.subscriptions.retrieve(existing.providerSubscriptionId);
      const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
      const price = subscription.items.data[0]?.price?.id;
      if (subscription.metadata?.ownerKey !== ownerKey(request) || customer !== existing.providerCustomerId || !['active', 'trialing'].includes(subscription.status) || !price || ![process.env.STRIPE_PRICE_MONTHLY, process.env.STRIPE_PRICE_YEARLY].includes(price)) return response.json({ upgraded: false });
      const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id;
      if (!invoiceId || (await stripe.invoices.retrieve(invoiceId)).status !== 'paid') return response.json({ upgraded: false });
      await prisma.subscription.updateMany({ where: { ownerKey: ownerKey(request), providerSubscriptionId: subscription.id }, data: { plan: 'premium', status: subscription.status, currentPeriodEnd: periodEnd(subscription.items.data[0]?.current_period_end), cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) } });
      return response.json({ upgraded: true });
    } catch { return response.status(503).json({ error: 'Nie udało się potwierdzić zmiany planu w Stripe.' }); }
  });

  router.post('/checkout', async (request, response) => {
    if (!options.allowLegacyCheckout) return response.status(503).json({ code: 'GOOGLE_PLAY_PENDING', error: 'Zakupy przez Google Play są w przygotowaniu. Nowe płatności Stripe są wyłączone.' });
    if (devPlan(ownerKey(request))) return response.status(409).json({ error: 'W trybie testu planu wyłącz go przed zmianą płatności Stripe.' });
    const stripe = getStripe();
    if (!stripe) return response.status(503).json({ error: 'Płatności testowe nie są jeszcze skonfigurowane.' });

    const existing = await prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
    if (existing?.plan === 'standard' && ['active', 'trialing'].includes(existing.status) && !existing.cancelAtPeriodEnd && request.body?.plan === 'premium') {
      const price = request.body?.interval === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY;
      if (!price || !existing.providerSubscriptionId || !existing.providerCustomerId) return response.status(503).json({ error: 'Zmiana planu wymaga skonfigurowanej ceny Premium i aktywnej subskrypcji Stripe.' });
      try {
        const subscription = await stripe.subscriptions.retrieve(existing.providerSubscriptionId);
        const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
        if (subscription.metadata?.ownerKey !== ownerKey(request) || customer !== existing.providerCustomerId || subscription.items.data.length !== 1 || !['active', 'trialing'].includes(subscription.status)) return response.status(409).json({ error: 'Nie można bezpiecznie potwierdzić obecnej subskrypcji.' });
        const portal = await stripe.billingPortal.sessions.create({ customer, return_url: `${billingReturnBase(request.socket.localAddress)}/api/billing/portal-return`, flow_data: { type: 'subscription_update_confirm', subscription_update_confirm: { subscription: subscription.id, items: [{ id: subscription.items.data[0].id, price, quantity: subscription.items.data[0].quantity || 1 }] } } });
        return response.json({ url: portal.url, sessionId: '', kind: 'upgrade' });
      } catch (error) { console.error('[billing] Nie udało się przygotować zmiany planu:', error instanceof Error ? error.message : 'Stripe error'); return response.status(503).json({ error: 'Nie udało się przygotować zmiany planu w Stripe. Sprawdź konfigurację portalu klienta i ceny Premium.' }); }
    }
    try {
      if (!await permitsReplacement(stripe, existing, ownerKey(request))) return response.status(409).json({ error: 'Masz aktywną subskrypcję bez zaplanowanego anulowania.' });
    } catch { return response.status(503).json({ error: 'Nie udało się sprawdzić anulowania w Stripe. Spróbuj ponownie.' }); }

    if (existing?.cancelAtPeriodEnd && ['active', 'trialing'].includes(existing.status) && request.body?.acceptReplacement !== true) return response.status(409).json({ error: 'Przed nową płatnością potwierdź rozpoczęcie nowego planu i opłatę za niego.' });

    const plan = request.body?.plan === 'standard' ? 'standard' : 'premium';
    const interval = request.body?.interval === 'yearly' ? 'yearly' : 'monthly';
    const price = plan === 'standard'
      ? (interval === 'yearly' ? process.env.STRIPE_STANDARD_PRICE_YEARLY : process.env.STRIPE_STANDARD_PRICE_MONTHLY)
      : (interval === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY);
    const testKey = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');
    if (!price && !testKey) return response.status(503).json({ error: `Brak ceny dla planu ${interval}.` });

    // In Stripe test mode we can start checkout before dashboard price IDs are
    // copied to .env. Production/live mode always requires an explicit price ID.
    const lineItem = price
      ? { price, quantity: 1 }
      : {
          price_data: {
            currency: 'pln',
            unit_amount: plan === 'standard' ? (interval === 'yearly' ? 4990 : 499) : (interval === 'yearly' ? 9990 : 999),
            recurring: { interval: interval === 'yearly' ? 'year' as const : 'month' as const },
            product_data: { name: `E‑Teczka ${plan === 'standard' ? 'Standard' : 'Premium'}` },
          },
          quantity: 1,
        };

    const returnBase = billingReturnBase(request.socket.localAddress);
    const replacesSubscriptionId = existing?.cancelAtPeriodEnd && ['active', 'trialing'].includes(existing.status) ? existing.providerSubscriptionId || '' : '';
    const checkoutParams = {
      mode: 'subscription',
      line_items: [lineItem],
      success_url: process.env.ETECZKA_BILLING_SUCCESS_URL || `${returnBase}/api/billing/confirm?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: process.env.ETECZKA_BILLING_CANCEL_URL || `${returnBase}/api/billing/cancel`,
      metadata: { ownerKey: ownerKey(request), plan, replacesSubscriptionId },
      subscription_data: { metadata: { ownerKey: ownerKey(request), plan } },
    } as Stripe.Checkout.SessionCreateParams & { managed_payments?: { enabled: boolean } };
    // Test accounts may have Managed Payments enabled globally. The local
    // Checkout flow does not use it, so explicitly disable it for this session.
    checkoutParams.managed_payments = { enabled: false };
    const session = await stripe.checkout.sessions.create(checkoutParams);
    return response.json({ url: session.url, sessionId: session.id });
  });

  return router;
}

export function createBillingWebhookHandler(prisma: PrismaClient, getStripe: () => Stripe | null = stripeClient) {
  return async (request: express.Request, response: express.Response) => {
    const stripe = getStripe();
    const signature = request.header('stripe-signature');
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!stripe || !signature || !secret) return response.status(503).json({ error: 'Webhook Stripe nie jest skonfigurowany.' });

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(request.body as Buffer, signature, secret);
    } catch {
      return response.status(400).json({ error: 'Nieprawidłowy podpis webhooka Stripe.' });
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
      const customerId = typeof session.customer === 'string' ? session.customer : null;
      const key = session.metadata?.ownerKey;
      if (!key || !subscriptionId || (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required')) return response.json({ received: true });
      const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
      if (stripeSubscription.metadata?.ownerKey !== key || !['active', 'trialing'].includes(stripeSubscription.status)) return response.json({ received: true });
      const current = await prisma.subscription.findUnique({ where: { ownerKey: key } });
      if (current?.providerSubscriptionId !== subscriptionId && !await permitsReplacement(stripe, current, key, session.metadata?.replacesSubscriptionId || null)) return response.json({ received: true });
      if (key) await prisma.subscription.upsert({
        where: { ownerKey: key },
        create: { ownerKey: key, providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: session.metadata?.plan === 'standard' ? 'standard' : 'premium', status: stripeSubscription.status },
        update: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: session.metadata?.plan === 'standard' ? 'standard' : 'premium', status: stripeSubscription.status, cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd(stripeSubscription.items.data[0]?.current_period_end) },
      });
      if (key) await recordTransaction(prisma, {
        ownerKey: key,
        providerReference: session.id,
        providerSubscriptionId: subscriptionId,
        type: 'subscription_payment',
        status: 'succeeded',
        amount: session.amount_total || 0,
        currency: session.currency,
        description: 'Subskrypcja E‑Teczka Premium',
      });
    }

    if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
      const eventSubscription = event.data.object as Stripe.Subscription;
      // Stripe may deliver events out of order; use the current provider state.
      const subscription = await stripe.subscriptions.retrieve(eventSubscription.id);
      const key = subscription.metadata?.ownerKey;
      if (key) {
        const current = await prisma.subscription.findUnique({ where: { ownerKey: key } });
        if (current?.providerSubscriptionId && current.providerSubscriptionId !== subscription.id) return response.json({ received: true });
      }
      const cancellationTime = periodEnd(subscription.cancel_at || (subscription.cancel_at_period_end ? subscription.items.data[0]?.current_period_end : null));
      const periodFinish = periodEnd(subscription.items.data[0]?.current_period_end);
      const actualPrice = subscription.items.data[0]?.price?.id;
      const pricePlan = actualPrice && [process.env.STRIPE_PRICE_MONTHLY, process.env.STRIPE_PRICE_YEARLY].includes(actualPrice) ? 'premium' : actualPrice && [process.env.STRIPE_STANDARD_PRICE_MONTHLY, process.env.STRIPE_STANDARD_PRICE_YEARLY].includes(actualPrice) ? 'standard' : (subscription.metadata?.plan === 'standard' ? 'standard' : 'premium');
      if (key && subscription.status !== 'canceled' && pricePlan === 'premium' && subscription.metadata?.plan === 'standard') {
        const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id;
        if (!invoiceId || (await stripe.invoices.retrieve(invoiceId)).status !== 'paid') return response.json({ received: true });
      }
      if (key) await prisma.subscription.upsert({
        where: { ownerKey: key },
        create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: subscription.status === 'canceled' ? 'free' : pricePlan, status: subscription.status, currentPeriodEnd: cancellationTime || periodFinish, cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) },
        update: { providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, plan: subscription.status === 'canceled' ? 'free' : pricePlan, status: subscription.status, currentPeriodEnd: cancellationTime || periodFinish, cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) },
      });
    }

    if (event.type === 'invoice.payment_failed') {
      const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
      const subscriptionReference = invoice.subscription;
      const subscriptionId = typeof subscriptionReference === 'string' ? subscriptionReference : subscriptionReference?.id;
      if (subscriptionId) {
        try {
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          const key = subscription.metadata?.ownerKey;
          if (!key || !['past_due', 'unpaid', 'incomplete'].includes(subscription.status)) return response.json({ received: true });
          const current = await prisma.subscription.findUnique({ where: { ownerKey: key } });
          if (current?.providerSubscriptionId && current.providerSubscriptionId !== subscription.id) return response.json({ received: true });
          if (key) await prisma.subscription.upsert({
            where: { ownerKey: key },
            create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: 'free', status: subscription.status },
            update: { plan: 'free', status: subscription.status },
          });
        } catch { return response.status(503).json({ error: 'Nie udało się sprawdzić subskrypcji.' }); }
      }
    }

    return response.json({ received: true });
  };
}
