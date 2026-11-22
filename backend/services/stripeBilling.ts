import Stripe from 'stripe';
import type { PrismaClient } from '@prisma/client';
import { calculateUnusedMonthsRefund, paidAccessEndsAt } from './refundPolicy';
import { billingReturnBase } from './billingReturnUrl';
import { prepareTags, tagIds } from './tagOwnership';
import { PLAN_LIMITS } from './planPolicy';

export function defaultStripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  return key ? new Stripe(key) : null;
}

export function periodEnd(unixSeconds: number | null | undefined): Date | null {
  return typeof unixSeconds === 'number' && unixSeconds > 0 ? new Date(unixSeconds * 1000) : null;
}

type PriorSubscription = { providerSubscriptionId: string | null; status: string; cancelAtPeriodEnd: boolean } | null;

export async function permitsReplacement(stripe: Stripe, current: PriorSubscription, owner: string, replacesId?: string | null): Promise<boolean> {
  if (!current || !['active', 'trialing'].includes(current.status)) return true;
  if (!current.cancelAtPeriodEnd || !current.providerSubscriptionId || (replacesId !== undefined && replacesId !== current.providerSubscriptionId)) return false;
  const previous = await stripe.subscriptions.retrieve(current.providerSubscriptionId);
  return previous.metadata?.ownerKey === owner && (previous.status === 'canceled' || Boolean(previous.cancel_at || previous.cancel_at_period_end));
}

export type PaidInvoiceDetails = {
  invoice: Stripe.Invoice;
  paymentIntentId: string | null;
  amountPaid: number;
  currency: string;
  periodStart: Date | null;
  periodEnd: Date | null;
};

export async function paidInvoiceDetails(stripe: Stripe, subscriptionId: string): Promise<PaidInvoiceDetails | null> {
  const invoices = await stripe.invoices.list({ subscription: subscriptionId, status: 'paid', limit: 100 });
  const invoice = invoices.data.find((item) => (item.amount_paid || 0) > 0);
  if (!invoice) return null;

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

export async function recordBillingTransaction(prisma: PrismaClient, data: {
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

export class BillingHttpError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

/** Validates and applies a completed Stripe Checkout session to Prisma subscription + transaction ledger. */
export async function applyCheckoutSession(prisma: PrismaClient, stripe: Stripe, session: Stripe.Checkout.Session, strict: boolean) {
  const currentOwner = session.metadata?.ownerKey;
  if (!currentOwner) {
    if (strict) throw new BillingHttpError(403, 'Sesja płatności nie zawiera właściciela.');
    return null;
  }
  if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
    if (strict) throw new BillingHttpError(402, 'Płatność nie została jeszcze potwierdzona.');
    return null;
  }

  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
  const customerId = typeof session.customer === 'string' ? session.customer : null;
  if (!subscriptionId) {
    if (strict) throw new BillingHttpError(409, 'Nie znaleziono subskrypcji dla tej płatności.');
    return null;
  }
  const stripeSubscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (stripeSubscription.metadata?.ownerKey !== currentOwner || !['active', 'trialing'].includes(stripeSubscription.status)) {
    if (strict) throw new BillingHttpError(409, 'Subskrypcja nie jest aktywna.');
    return null;
  }
  const existing = await prisma.subscription.findUnique({ where: { ownerKey: currentOwner } });
  if (existing?.providerSubscriptionId !== subscriptionId && !await permitsReplacement(stripe, existing, currentOwner, session.metadata?.replacesSubscriptionId || null)) {
    if (strict) throw new BillingHttpError(409, 'Konto ma już inną aktywną subskrypcję.');
    return null;
  }
  const rawMetaPlan = String(session.metadata?.plan || 'premium');
  const plan = ['standard', 'premium', 'family', 'business'].includes(rawMetaPlan) ? rawMetaPlan : 'premium';
  const planLabels: Record<string, string> = { standard: 'Standard', premium: 'Premium', family: 'Rodzinny', business: 'Firmowy' };
  await prisma.subscription.upsert({
    where: { ownerKey: currentOwner },
    create: { ownerKey: currentOwner, providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan, status: stripeSubscription.status },
    update: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan, status: stripeSubscription.status, cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd(stripeSubscription.items.data[0]?.current_period_end) },
  });
  await recordBillingTransaction(prisma, {
    ownerKey: currentOwner,
    providerReference: session.id,
    providerSubscriptionId: subscriptionId,
    type: 'subscription_payment',
    status: 'succeeded',
    amount: session.amount_total || 0,
    currency: session.currency,
    description: `Subskrypcja MojaTeczka ${planLabels[plan] || 'Premium'}`,
  });
  return plan;
}

export async function getStripeManageSummary(stripe: Stripe, key: string, localSubscription: { plan: string; status: string; providerSubscriptionId: string | null; currentPeriodEnd: Date | null }) {
  const subscription = await stripe.subscriptions.retrieve(localSubscription.providerSubscriptionId!);
  if (subscription.metadata?.ownerKey !== key) throw new BillingHttpError(403, 'Ta subskrypcja nie należy do tego użytkownika.');
  const item = subscription.items.data[0];
  const details = await paidInvoiceDetails(stripe, subscription.id);
  return {
    plan: localSubscription.plan,
    status: subscription.status,
    interval: item?.price.recurring?.interval || null,
    intervalCount: item?.price.recurring?.interval_count || 1,
    amount: item?.price.unit_amount || details?.amountPaid || 0,
    currency: item?.price.currency || details?.currency || 'pln',
    renewalAt: subscription.cancel_at || subscription.cancel_at_period_end ? periodEnd(subscription.cancel_at || 0) || details?.periodEnd || localSubscription.currentPeriodEnd || null : details?.periodEnd || localSubscription.currentPeriodEnd || null,
    cancellationScheduled: Boolean(subscription.cancel_at || subscription.cancel_at_period_end),
    cancellationPolicy: 'Bieżący rozpoczęty miesiąc jest opłacony. Zwrot obejmuje wyłącznie pełne niewykorzystane miesiące.',
  };
}

export async function previewStripeCancellation(prisma: PrismaClient, stripe: Stripe, key: string, ownerId: number, subscriptionId: string) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.metadata?.ownerKey !== key) throw new BillingHttpError(403, 'Ta subskrypcja nie należy do tego użytkownika.');
  const details = await paidInvoiceDetails(stripe, subscription.id);
  if (!details) throw new BillingHttpError(409, 'Nie znaleziono opłaconej faktury.');
  const now = new Date();
  const accessUntil = periodEnd(subscription.cancel_at || 0) || paidAccessEndsAt(details, now);
  if (!accessUntil) throw new BillingHttpError(409, 'Okres subskrypcji już się zakończył.');
  const estimate = calculateUnusedMonthsRefund(details, now);
  await prepareTags(prisma);
  const [documentCount, ownedTags] = await Promise.all([prisma.document.count({ where: { folder: { ownerId } } }), tagIds(prisma, ownerId)]);
  return {
    accessUntil,
    refundedAmount: estimate.refundAmount,
    refundedMonths: estimate.refundedMonths,
    currency: details.currency,
    alreadyScheduled: Boolean(subscription.cancel_at || subscription.cancel_at_period_end),
    restrictedDocuments: Math.max(0, documentCount - PLAN_LIMITS.free.documents!),
    inactiveTags: Math.max(0, ownedTags.length - PLAN_LIMITS.free.tags!),
  };
}

export async function cancelStripeSubscription(prisma: PrismaClient, stripe: Stripe, key: string, subscriptionId: string, plan: string | undefined) {
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  if (subscription.metadata?.ownerKey !== key) throw new BillingHttpError(403, 'Ta subskrypcja nie należy do tego użytkownika.');
  const details = await paidInvoiceDetails(stripe, subscription.id);
  if (!details) throw new BillingHttpError(409, 'Nie znaleziono opłaconej faktury tej subskrypcji.');
  const now = new Date();
  const { refundedMonths, refundAmount } = calculateUnusedMonthsRefund(details, now);
  const accessUntil = periodEnd(subscription.cancel_at || 0) || paidAccessEndsAt(details, now);
  if (!accessUntil) throw new BillingHttpError(409, 'Okres subskrypcji już się zakończył.');
  const existingRefund = await prisma.billingTransaction.findFirst({
    where: { providerSubscriptionId: subscription.id, type: 'refund', status: { in: ['succeeded', 'pending'] } },
  });

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
    if (!details.paymentIntentId) throw new BillingHttpError(409, 'Nie znaleziono płatności do zwrotu.');
    const refund = await stripe.refunds.create(
      { payment_intent: details.paymentIntentId, amount: refundAmount, reason: 'requested_by_customer' },
      { idempotencyKey: `eteczka-refund-${subscription.id}-${details.invoice.id}` },
    );
    refundId = refund.id;
    await recordBillingTransaction(prisma, {
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

  return {
    plan,
    accessUntil,
    refundedAmount: existingRefund ? existingRefund.amount : refundAmount,
    refundedMonths,
    refundId,
  };
}

export async function processStripeWebhookEvent(prisma: PrismaClient, stripe: Stripe, event: Stripe.Event) {
  if (event.type === 'checkout.session.completed') {
    await applyCheckoutSession(prisma, stripe, event.data.object as Stripe.Checkout.Session, false);
    return;
  }

  if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
    const eventSubscription = event.data.object as Stripe.Subscription;
    const subscription = await stripe.subscriptions.retrieve(eventSubscription.id);
    const key = subscription.metadata?.ownerKey;
    if (key) {
      const current = await prisma.subscription.findUnique({ where: { ownerKey: key } });
      if (current?.providerSubscriptionId && current.providerSubscriptionId !== subscription.id) return;
    }
    const cancellationTime = periodEnd(subscription.cancel_at || (subscription.cancel_at_period_end ? subscription.items.data[0]?.current_period_end : null));
    const periodFinish = periodEnd(subscription.items.data[0]?.current_period_end);
    const actualPrice = subscription.items.data[0]?.price?.id;
    const priceToPlan: Array<[string | undefined, 'standard' | 'premium' | 'family' | 'business']> = [
      [process.env.STRIPE_STANDARD_PRICE_MONTHLY, 'standard'],
      [process.env.STRIPE_STANDARD_PRICE_YEARLY, 'standard'],
      [process.env.STRIPE_PRICE_MONTHLY, 'premium'],
      [process.env.STRIPE_PRICE_YEARLY, 'premium'],
      [process.env.STRIPE_FAMILY_PRICE_MONTHLY, 'family'],
      [process.env.STRIPE_FAMILY_PRICE_YEARLY, 'family'],
      [process.env.STRIPE_BUSINESS_PRICE_MONTHLY, 'business'],
      [process.env.STRIPE_BUSINESS_PRICE_YEARLY, 'business'],
    ];
    const metaPlan = String(subscription.metadata?.plan || '');
    const fallbackMetaPlan = ['standard', 'premium', 'family', 'business'].includes(metaPlan) ? metaPlan : 'premium';
    const pricePlan = (actualPrice ? priceToPlan.find(([id]) => id === actualPrice)?.[1] : undefined) || fallbackMetaPlan;
    const planRank: Record<string, number> = { standard: 1, premium: 2, family: 3, business: 4 };
    if (key && subscription.status !== 'canceled' && (planRank[pricePlan] ?? 0) > (planRank[metaPlan] ?? 0)) {
      const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : subscription.latest_invoice?.id;
      if (!invoiceId || (await stripe.invoices.retrieve(invoiceId)).status !== 'paid') return;
    }
    if (key) {
      await prisma.subscription.upsert({
        where: { ownerKey: key },
        create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: subscription.status === 'canceled' ? 'free' : pricePlan, status: subscription.status, currentPeriodEnd: cancellationTime || periodFinish, cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) },
        update: { providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, plan: subscription.status === 'canceled' ? 'free' : pricePlan, status: subscription.status, currentPeriodEnd: cancellationTime || periodFinish, cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) },
      });
    }
    return;
  }

  if (event.type === 'invoice.payment_failed') {
    const invoice = event.data.object as Stripe.Invoice & { subscription?: string | Stripe.Subscription | null };
    const subscriptionReference = invoice.subscription;
    const subscriptionId = typeof subscriptionReference === 'string' ? subscriptionReference : subscriptionReference?.id;
    if (!subscriptionId) return;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    const key = subscription.metadata?.ownerKey;
    if (!key || !['past_due', 'unpaid', 'incomplete'].includes(subscription.status)) return;
    const current = await prisma.subscription.findUnique({ where: { ownerKey: key } });
    if (current?.providerSubscriptionId && current.providerSubscriptionId !== subscription.id) return;
    await prisma.subscription.upsert({
      where: { ownerKey: key },
      create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: 'free', status: subscription.status },
      update: { plan: 'free', status: subscription.status },
    });
  }
}
