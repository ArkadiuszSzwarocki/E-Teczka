import express from 'express';
import Stripe from 'stripe';
import type { PrismaClient } from '@prisma/client';

function stripeClient() {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

function ownerKey(request: express.Request) {
  return String(request.res?.locals.billingOwnerKey || 'desktop-local');
}

function periodEnd(unixSeconds: number | null | undefined) {
  return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;
}

function calendarMonthIndex(date: Date) {
  return date.getUTCFullYear() * 12 + date.getUTCMonth();
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

function calculateUnusedMonthsRefund(details: PaidInvoiceDetails, now: Date) {
  if (!details.periodStart || !details.periodEnd || details.amountPaid <= 0) {
    return { billedMonths: 0, refundedMonths: 0, refundAmount: 0 };
  }

  const billedMonths = Math.max(1, calendarMonthIndex(details.periodEnd) - calendarMonthIndex(details.periodStart));
  // The month in which the cancellation is requested is consumed. Only whole
  // calendar months after it are refundable, as agreed for E‑Teczka plans.
  const refundedMonths = Math.max(0, Math.min(
    billedMonths - 1,
    calendarMonthIndex(details.periodEnd) - calendarMonthIndex(now) - 1,
  ));
  return {
    billedMonths,
    refundedMonths,
    refundAmount: Math.min(details.amountPaid, Math.round((details.amountPaid * refundedMonths) / billedMonths)),
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

export function createBillingRouter(prisma: PrismaClient) {
  const router = express.Router();

  router.get('/status', async (request, response) => {
    const subscription = await prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
    const active = subscription?.status === 'active' || subscription?.status === 'trialing';
    response.json({
      plan: active ? (subscription?.plan === 'standard' ? 'standard' : 'premium') : 'free',
      status: subscription?.status ?? 'inactive',
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
    });
  });

  // This route is loaded only when the account menu is opened. Keeping the
  // Stripe request out of /status prevents the desktop's regular refresh from
  // repeatedly calling Stripe.
  router.get('/manage', async (request, response) => {
    const key = ownerKey(request);
    const localSubscription = await prisma.subscription.findUnique({ where: { ownerKey: key } });
    const active = localSubscription?.status === 'active' || localSubscription?.status === 'trialing';
    if (!active || !localSubscription?.providerSubscriptionId) {
      return response.json({ plan: 'free', status: localSubscription?.status || 'inactive' });
    }

    const stripe = stripeClient();
    if (!stripe) return response.json({ plan: 'premium', status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
    try {
      const subscription = await stripe.subscriptions.retrieve(localSubscription.providerSubscriptionId);
      if (subscription.metadata?.ownerKey !== key) return response.status(403).json({ error: 'Ta subskrypcja nie należy do tego użytkownika.' });
      const item = subscription.items.data[0];
      const details = await paidInvoiceDetails(stripe, subscription.id);
      return response.json({
        plan: 'premium',
        status: subscription.status,
        interval: item?.price.recurring?.interval || null,
        intervalCount: item?.price.recurring?.interval_count || 1,
        amount: item?.price.unit_amount || details?.amountPaid || 0,
        currency: item?.price.currency || details?.currency || 'pln',
        renewalAt: details?.periodEnd || localSubscription.currentPeriodEnd || null,
        cancellationPolicy: 'Bieżący rozpoczęty miesiąc jest opłacony. Zwrot obejmuje wyłącznie pełne niewykorzystane miesiące.',
      });
    } catch {
      return response.json({ plan: 'premium', status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
    }
  });

  router.get('/confirm', async (request, response) => {
    const stripe = stripeClient();
    const sessionId = typeof request.query.session_id === 'string' ? request.query.session_id : '';
    if (!stripe || !sessionId) return response.status(400).send('Brak identyfikatora sesji płatności.');

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const sessionOwner = session.metadata?.ownerKey;
      const currentOwner = ownerKey(request);
      if (!sessionOwner || sessionOwner !== currentOwner) return response.status(403).send('Sesja płatności nie należy do tego użytkownika.');
      if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
        return response.status(402).send('Płatność nie została jeszcze potwierdzona.');
      }

      const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
      const customerId = typeof session.customer === 'string' ? session.customer : null;
      await prisma.subscription.upsert({
        where: { ownerKey: currentOwner },
        create: { ownerKey: currentOwner, providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: session.metadata?.plan === 'standard' ? 'standard' : 'premium', status: 'active' },
        update: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: session.metadata?.plan === 'standard' ? 'standard' : 'premium', status: 'active' },
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

      response.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka — płatność potwierdzona</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność potwierdzona</h1><p>Plan Premium jest aktywny. Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p></body>');
    } catch {
      response.status(400).send('Nie udało się potwierdzić płatności.');
    }
  });

  router.get('/cancel', (_request, response) => {
    response.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka — płatność anulowana</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność anulowana</h1><p>Nie pobrano opłaty. Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p></body>');
  });

  router.post('/cancel-subscription', async (request, response) => {
    const stripe = stripeClient();
    if (!stripe) return response.status(503).json({ error: 'Płatności nie są skonfigurowane.' });
    const key = ownerKey(request);
    const localSubscription = await prisma.subscription.findUnique({ where: { ownerKey: key } });
    const requestedId = typeof request.body?.subscriptionId === 'string' ? request.body.subscriptionId.trim() : '';
    const subscriptionId = requestedId || localSubscription?.providerSubscriptionId;
    if (!subscriptionId) return response.status(404).json({ error: 'Nie znaleziono subskrypcji.' });

    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      // A historical subscription can be refunded only by its owner. This also
      // allows recovery when it was cancelled before the refund code was fixed.
      if (subscription.metadata?.ownerKey !== key) return response.status(403).json({ error: 'Ta subskrypcja nie należy do tego użytkownika.' });
      const details = await paidInvoiceDetails(stripe, subscription.id);
      if (!details) return response.status(409).json({ error: 'Nie znaleziono opłaconej faktury tej subskrypcji.' });
      const { refundedMonths, refundAmount } = calculateUnusedMonthsRefund(details, new Date());
      const existingRefund = await prisma.billingTransaction.findFirst({
        where: { providerSubscriptionId: subscription.id, type: 'refund', status: { in: ['succeeded', 'pending'] } },
      });

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

      if (subscription.status !== 'canceled') await stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
      const affectsCurrentPlan = localSubscription?.providerSubscriptionId === subscription.id;
      if (affectsCurrentPlan) await prisma.subscription.update({
        where: { ownerKey: key },
        data: { plan: 'free', status: 'canceled', cancelAtPeriodEnd: false },
      });
      return response.json({
        plan: affectsCurrentPlan ? 'free' : (localSubscription?.status === 'active' || localSubscription?.status === 'trialing' ? 'premium' : 'free'),
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
      const stripe = stripeClient();
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

  router.post('/checkout', async (request, response) => {
    const stripe = stripeClient();
    if (!stripe) return response.status(503).json({ error: 'Płatności testowe nie są jeszcze skonfigurowane.' });

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

    const checkoutParams = {
      mode: 'subscription',
      line_items: [lineItem],
      success_url: process.env.ETECZKA_BILLING_SUCCESS_URL || 'http://localhost:3000/api/billing/confirm?session_id={CHECKOUT_SESSION_ID}',
      cancel_url: process.env.ETECZKA_BILLING_CANCEL_URL || 'http://localhost:3000/api/billing/cancel',
      metadata: { ownerKey: ownerKey(request), plan },
      subscription_data: { metadata: { ownerKey: ownerKey(request), plan } },
    } as Stripe.Checkout.SessionCreateParams & { managed_payments?: { enabled: boolean } };
    // Test accounts may have Managed Payments enabled globally. The local
    // Checkout flow does not use it, so explicitly disable it for this session.
    checkoutParams.managed_payments = { enabled: false };
    const session = await stripe.checkout.sessions.create(checkoutParams);
    return response.json({ url: session.url });
  });

  return router;
}

export function createBillingWebhookHandler(prisma: PrismaClient) {
  return async (request: express.Request, response: express.Response) => {
    const stripe = stripeClient();
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
      if (key) await prisma.subscription.upsert({
        where: { ownerKey: key },
        create: { ownerKey: key, providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: session.metadata?.plan === 'standard' ? 'standard' : 'premium', status: 'active' },
        update: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: session.metadata?.plan === 'standard' ? 'standard' : 'premium', status: 'active' },
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
      const subscription = event.data.object as Stripe.Subscription & { metadata?: Record<string, string>; current_period_end?: number };
      const key = subscription.metadata?.ownerKey;
      if (key) await prisma.subscription.upsert({
        where: { ownerKey: key },
        create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: event.type.endsWith('deleted') ? 'free' : (subscription.metadata?.plan === 'standard' ? 'standard' : 'premium'), status: event.type.endsWith('deleted') ? 'canceled' : subscription.status, currentPeriodEnd: periodEnd(subscription.current_period_end), cancelAtPeriodEnd: subscription.cancel_at_period_end },
        update: { providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, plan: event.type.endsWith('deleted') ? 'free' : (subscription.metadata?.plan === 'standard' ? 'standard' : 'premium'), status: event.type.endsWith('deleted') ? 'canceled' : subscription.status, currentPeriodEnd: periodEnd(subscription.current_period_end), cancelAtPeriodEnd: subscription.cancel_at_period_end },
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
          if (key) await prisma.subscription.upsert({
            where: { ownerKey: key },
            create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: 'free', status: 'past_due' },
            update: { plan: 'free', status: 'past_due' },
          });
        } catch {
          // Stripe will retry delivery. A transient lookup failure must not
          // cause the webhook endpoint to fail permanently.
        }
      }
    }

    return response.json({ received: true });
  };
}
