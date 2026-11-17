"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BillingHttpError = void 0;
exports.defaultStripeClient = defaultStripeClient;
exports.periodEnd = periodEnd;
exports.permitsReplacement = permitsReplacement;
exports.paidInvoiceDetails = paidInvoiceDetails;
exports.recordBillingTransaction = recordBillingTransaction;
exports.applyCheckoutSession = applyCheckoutSession;
exports.getStripeManageSummary = getStripeManageSummary;
exports.previewStripeCancellation = previewStripeCancellation;
exports.cancelStripeSubscription = cancelStripeSubscription;
exports.processStripeWebhookEvent = processStripeWebhookEvent;
const stripe_1 = __importDefault(require("stripe"));
const refundPolicy_1 = require("./refundPolicy");
const tagOwnership_1 = require("./tagOwnership");
const planPolicy_1 = require("./planPolicy");
function defaultStripeClient() {
    const key = process.env.STRIPE_SECRET_KEY;
    return key ? new stripe_1.default(key) : null;
}
function periodEnd(unixSeconds) {
    return typeof unixSeconds === 'number' && unixSeconds > 0 ? new Date(unixSeconds * 1000) : null;
}
function permitsReplacement(stripe, current, owner, replacesId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!current || !['active', 'trialing'].includes(current.status))
            return true;
        if (!current.cancelAtPeriodEnd || !current.providerSubscriptionId || (replacesId !== undefined && replacesId !== current.providerSubscriptionId))
            return false;
        const previous = yield stripe.subscriptions.retrieve(current.providerSubscriptionId);
        return ((_a = previous.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey) === owner && (previous.status === 'canceled' || Boolean(previous.cancel_at || previous.cancel_at_period_end));
    });
}
function paidInvoiceDetails(stripe, subscriptionId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const invoices = yield stripe.invoices.list({ subscription: subscriptionId, status: 'paid', limit: 100 });
        const invoice = invoices.data.find((item) => (item.amount_paid || 0) > 0);
        if (!invoice)
            return null;
        const line = invoice.lines.data.find((item) => { var _a, _b; return ((_a = item.period) === null || _a === void 0 ? void 0 : _a.start) && ((_b = item.period) === null || _b === void 0 ? void 0 : _b.end); }) || invoice.lines.data[0];
        const payments = yield stripe.invoicePayments.list({ invoice: invoice.id, status: 'paid', limit: 10 });
        const paidPayment = payments.data.find((item) => item.payment.payment_intent || item.payment.charge) || payments.data[0];
        const paymentIntent = paidPayment === null || paidPayment === void 0 ? void 0 : paidPayment.payment.payment_intent;
        const paymentIntentId = typeof paymentIntent === 'string' ? paymentIntent : (paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.id) || null;
        return {
            invoice,
            paymentIntentId,
            amountPaid: (paidPayment === null || paidPayment === void 0 ? void 0 : paidPayment.amount_paid) || invoice.amount_paid || 0,
            currency: invoice.currency || 'pln',
            periodStart: periodEnd((_a = line === null || line === void 0 ? void 0 : line.period) === null || _a === void 0 ? void 0 : _a.start),
            periodEnd: periodEnd((_b = line === null || line === void 0 ? void 0 : line.period) === null || _b === void 0 ? void 0 : _b.end),
        };
    });
}
function recordBillingTransaction(prisma, data) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.billingTransaction.upsert({
            where: { providerReference: data.providerReference },
            create: Object.assign(Object.assign({}, data), { currency: data.currency || 'pln' }),
            update: { status: data.status, amount: data.amount, description: data.description, providerSubscriptionId: data.providerSubscriptionId },
        });
    });
}
class BillingHttpError extends Error {
    constructor(statusCode, message) {
        super(message);
        this.statusCode = statusCode;
    }
}
exports.BillingHttpError = BillingHttpError;
/** Validates and applies a completed Stripe Checkout session to Prisma subscription + transaction ledger. */
function applyCheckoutSession(prisma, stripe, session, strict) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        const currentOwner = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey;
        if (!currentOwner) {
            if (strict)
                throw new BillingHttpError(403, 'Sesja płatności nie zawiera właściciela.');
            return null;
        }
        if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
            if (strict)
                throw new BillingHttpError(402, 'Płatność nie została jeszcze potwierdzona.');
            return null;
        }
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
        const customerId = typeof session.customer === 'string' ? session.customer : null;
        if (!subscriptionId) {
            if (strict)
                throw new BillingHttpError(409, 'Nie znaleziono subskrypcji dla tej płatności.');
            return null;
        }
        const stripeSubscription = yield stripe.subscriptions.retrieve(subscriptionId);
        if (((_b = stripeSubscription.metadata) === null || _b === void 0 ? void 0 : _b.ownerKey) !== currentOwner || !['active', 'trialing'].includes(stripeSubscription.status)) {
            if (strict)
                throw new BillingHttpError(409, 'Subskrypcja nie jest aktywna.');
            return null;
        }
        const existing = yield prisma.subscription.findUnique({ where: { ownerKey: currentOwner } });
        if ((existing === null || existing === void 0 ? void 0 : existing.providerSubscriptionId) !== subscriptionId && !(yield permitsReplacement(stripe, existing, currentOwner, ((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.replacesSubscriptionId) || null))) {
            if (strict)
                throw new BillingHttpError(409, 'Konto ma już inną aktywną subskrypcję.');
            return null;
        }
        const plan = ((_d = session.metadata) === null || _d === void 0 ? void 0 : _d.plan) === 'standard' ? 'standard' : 'premium';
        yield prisma.subscription.upsert({
            where: { ownerKey: currentOwner },
            create: { ownerKey: currentOwner, providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan, status: stripeSubscription.status },
            update: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan, status: stripeSubscription.status, cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd((_e = stripeSubscription.items.data[0]) === null || _e === void 0 ? void 0 : _e.current_period_end) },
        });
        yield recordBillingTransaction(prisma, {
            ownerKey: currentOwner,
            providerReference: session.id,
            providerSubscriptionId: subscriptionId,
            type: 'subscription_payment',
            status: 'succeeded',
            amount: session.amount_total || 0,
            currency: session.currency,
            description: 'Subskrypcja E‑Teczka Premium',
        });
        return plan;
    });
}
function getStripeManageSummary(stripe, key, localSubscription) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const subscription = yield stripe.subscriptions.retrieve(localSubscription.providerSubscriptionId);
        if (((_a = subscription.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey) !== key)
            throw new BillingHttpError(403, 'Ta subskrypcja nie należy do tego użytkownika.');
        const item = subscription.items.data[0];
        const details = yield paidInvoiceDetails(stripe, subscription.id);
        return {
            plan: localSubscription.plan,
            status: subscription.status,
            interval: ((_b = item === null || item === void 0 ? void 0 : item.price.recurring) === null || _b === void 0 ? void 0 : _b.interval) || null,
            intervalCount: ((_c = item === null || item === void 0 ? void 0 : item.price.recurring) === null || _c === void 0 ? void 0 : _c.interval_count) || 1,
            amount: (item === null || item === void 0 ? void 0 : item.price.unit_amount) || (details === null || details === void 0 ? void 0 : details.amountPaid) || 0,
            currency: (item === null || item === void 0 ? void 0 : item.price.currency) || (details === null || details === void 0 ? void 0 : details.currency) || 'pln',
            renewalAt: subscription.cancel_at || subscription.cancel_at_period_end ? periodEnd(subscription.cancel_at || 0) || (details === null || details === void 0 ? void 0 : details.periodEnd) || localSubscription.currentPeriodEnd || null : (details === null || details === void 0 ? void 0 : details.periodEnd) || localSubscription.currentPeriodEnd || null,
            cancellationScheduled: Boolean(subscription.cancel_at || subscription.cancel_at_period_end),
            cancellationPolicy: 'Bieżący rozpoczęty miesiąc jest opłacony. Zwrot obejmuje wyłącznie pełne niewykorzystane miesiące.',
        };
    });
}
function previewStripeCancellation(prisma, stripe, key, ownerId, subscriptionId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const subscription = yield stripe.subscriptions.retrieve(subscriptionId);
        if (((_a = subscription.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey) !== key)
            throw new BillingHttpError(403, 'Ta subskrypcja nie należy do tego użytkownika.');
        const details = yield paidInvoiceDetails(stripe, subscription.id);
        if (!details)
            throw new BillingHttpError(409, 'Nie znaleziono opłaconej faktury.');
        const now = new Date();
        const accessUntil = periodEnd(subscription.cancel_at || 0) || (0, refundPolicy_1.paidAccessEndsAt)(details, now);
        if (!accessUntil)
            throw new BillingHttpError(409, 'Okres subskrypcji już się zakończył.');
        const estimate = (0, refundPolicy_1.calculateUnusedMonthsRefund)(details, now);
        yield (0, tagOwnership_1.prepareTags)(prisma);
        const [documentCount, ownedTags] = yield Promise.all([prisma.document.count({ where: { folder: { ownerId } } }), (0, tagOwnership_1.tagIds)(prisma, ownerId)]);
        return {
            accessUntil,
            refundedAmount: estimate.refundAmount,
            refundedMonths: estimate.refundedMonths,
            currency: details.currency,
            alreadyScheduled: Boolean(subscription.cancel_at || subscription.cancel_at_period_end),
            restrictedDocuments: Math.max(0, documentCount - planPolicy_1.PLAN_LIMITS.free.documents),
            inactiveTags: Math.max(0, ownedTags.length - planPolicy_1.PLAN_LIMITS.free.tags),
        };
    });
}
function cancelStripeSubscription(prisma, stripe, key, subscriptionId, plan) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const subscription = yield stripe.subscriptions.retrieve(subscriptionId);
        if (((_a = subscription.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey) !== key)
            throw new BillingHttpError(403, 'Ta subskrypcja nie należy do tego użytkownika.');
        const details = yield paidInvoiceDetails(stripe, subscription.id);
        if (!details)
            throw new BillingHttpError(409, 'Nie znaleziono opłaconej faktury tej subskrypcji.');
        const now = new Date();
        const { refundedMonths, refundAmount } = (0, refundPolicy_1.calculateUnusedMonthsRefund)(details, now);
        const accessUntil = periodEnd(subscription.cancel_at || 0) || (0, refundPolicy_1.paidAccessEndsAt)(details, now);
        if (!accessUntil)
            throw new BillingHttpError(409, 'Okres subskrypcji już się zakończył.');
        const existingRefund = yield prisma.billingTransaction.findFirst({
            where: { providerSubscriptionId: subscription.id, type: 'refund', status: { in: ['succeeded', 'pending'] } },
        });
        if (!subscription.cancel_at && !subscription.cancel_at_period_end && subscription.status !== 'canceled') {
            const endsAtInvoice = details.periodEnd && accessUntil.getTime() >= details.periodEnd.getTime();
            yield stripe.subscriptions.update(subscription.id, endsAtInvoice
                ? { cancel_at_period_end: true, proration_behavior: 'none' }
                : { cancel_at: Math.floor(accessUntil.getTime() / 1000), proration_behavior: 'none' });
        }
        yield prisma.subscription.update({ where: { ownerKey: key }, data: { cancelAtPeriodEnd: true, currentPeriodEnd: accessUntil } });
        let refundId = null;
        if (existingRefund) {
            refundId = existingRefund.providerReference;
        }
        else if (refundAmount > 0) {
            if (!details.paymentIntentId)
                throw new BillingHttpError(409, 'Nie znaleziono płatności do zwrotu.');
            const refund = yield stripe.refunds.create({ payment_intent: details.paymentIntentId, amount: refundAmount, reason: 'requested_by_customer' }, { idempotencyKey: `eteczka-refund-${subscription.id}-${details.invoice.id}` });
            refundId = refund.id;
            yield recordBillingTransaction(prisma, {
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
    });
}
function processStripeWebhookEvent(prisma, stripe, event) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j;
        if (event.type === 'checkout.session.completed') {
            yield applyCheckoutSession(prisma, stripe, event.data.object, false);
            return;
        }
        if (event.type === 'customer.subscription.updated' || event.type === 'customer.subscription.deleted') {
            const eventSubscription = event.data.object;
            const subscription = yield stripe.subscriptions.retrieve(eventSubscription.id);
            const key = (_a = subscription.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey;
            if (key) {
                const current = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
                if ((current === null || current === void 0 ? void 0 : current.providerSubscriptionId) && current.providerSubscriptionId !== subscription.id)
                    return;
            }
            const cancellationTime = periodEnd(subscription.cancel_at || (subscription.cancel_at_period_end ? (_b = subscription.items.data[0]) === null || _b === void 0 ? void 0 : _b.current_period_end : null));
            const periodFinish = periodEnd((_c = subscription.items.data[0]) === null || _c === void 0 ? void 0 : _c.current_period_end);
            const actualPrice = (_e = (_d = subscription.items.data[0]) === null || _d === void 0 ? void 0 : _d.price) === null || _e === void 0 ? void 0 : _e.id;
            const pricePlan = actualPrice && [process.env.STRIPE_PRICE_MONTHLY, process.env.STRIPE_PRICE_YEARLY].includes(actualPrice)
                ? 'premium'
                : actualPrice && [process.env.STRIPE_STANDARD_PRICE_MONTHLY, process.env.STRIPE_STANDARD_PRICE_YEARLY].includes(actualPrice)
                    ? 'standard'
                    : (((_f = subscription.metadata) === null || _f === void 0 ? void 0 : _f.plan) === 'standard' ? 'standard' : 'premium');
            if (key && subscription.status !== 'canceled' && pricePlan === 'premium' && ((_g = subscription.metadata) === null || _g === void 0 ? void 0 : _g.plan) === 'standard') {
                const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : (_h = subscription.latest_invoice) === null || _h === void 0 ? void 0 : _h.id;
                if (!invoiceId || (yield stripe.invoices.retrieve(invoiceId)).status !== 'paid')
                    return;
            }
            if (key) {
                yield prisma.subscription.upsert({
                    where: { ownerKey: key },
                    create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: subscription.status === 'canceled' ? 'free' : pricePlan, status: subscription.status, currentPeriodEnd: cancellationTime || periodFinish, cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) },
                    update: { providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, plan: subscription.status === 'canceled' ? 'free' : pricePlan, status: subscription.status, currentPeriodEnd: cancellationTime || periodFinish, cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) },
                });
            }
            return;
        }
        if (event.type === 'invoice.payment_failed') {
            const invoice = event.data.object;
            const subscriptionReference = invoice.subscription;
            const subscriptionId = typeof subscriptionReference === 'string' ? subscriptionReference : subscriptionReference === null || subscriptionReference === void 0 ? void 0 : subscriptionReference.id;
            if (!subscriptionId)
                return;
            const subscription = yield stripe.subscriptions.retrieve(subscriptionId);
            const key = (_j = subscription.metadata) === null || _j === void 0 ? void 0 : _j.ownerKey;
            if (!key || !['past_due', 'unpaid', 'incomplete'].includes(subscription.status))
                return;
            const current = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
            if ((current === null || current === void 0 ? void 0 : current.providerSubscriptionId) && current.providerSubscriptionId !== subscription.id)
                return;
            yield prisma.subscription.upsert({
                where: { ownerKey: key },
                create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: 'free', status: subscription.status },
                update: { plan: 'free', status: subscription.status },
            });
        }
    });
}
