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
exports.createBillingRouter = createBillingRouter;
exports.createBillingWebhookHandler = createBillingWebhookHandler;
const express_1 = __importDefault(require("express"));
const stripe_1 = __importDefault(require("stripe"));
const refundPolicy_1 = require("../services/refundPolicy");
const billingReturnUrl_1 = require("../services/billingReturnUrl");
const devPlans_1 = require("../services/devPlans");
const planUsage_1 = require("../services/planUsage");
const ocrPremium_1 = require("../services/ocrPremium");
const tagOwnership_1 = require("../services/tagOwnership");
const planPolicy_1 = require("../services/planPolicy");
function stripeClient() {
    const key = process.env.STRIPE_SECRET_KEY;
    return key ? new stripe_1.default(key) : null;
}
function ownerKey(request) {
    var _a;
    return String(((_a = request.res) === null || _a === void 0 ? void 0 : _a.locals.billingOwnerKey) || 'desktop-local');
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
        // Stripe's current Subscription object no longer exposes the billing period.
        // The paid invoice line is the reliable source of the purchased period.
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
function recordTransaction(prisma, data) {
    return __awaiter(this, void 0, void 0, function* () {
        return prisma.billingTransaction.upsert({
            where: { providerReference: data.providerReference },
            create: Object.assign(Object.assign({}, data), { currency: data.currency || 'pln' }),
            update: { status: data.status, amount: data.amount, description: data.description, providerSubscriptionId: data.providerSubscriptionId },
        });
    });
}
function createBillingRouter(prisma, getStripe = stripeClient, options = {}) {
    const router = express_1.default.Router();
    router.get('/usage', (_request, response) => __awaiter(this, void 0, void 0, function* () {
        try {
            response.json(yield (0, planUsage_1.getPlanUsage)(prisma, (0, ocrPremium_1.ocrOwnerKey)(response), Number(response.locals.userId || 1)));
        }
        catch (error) {
            console.error('[billing] Nie udało się pobrać limitów:', error);
            response.status(500).json({ error: 'Nie udało się pobrać wykorzystania planu.' });
        }
    }));
    router.get('/status', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const override = (0, devPlans_1.devPlan)(ownerKey(request));
        if (override)
            return response.json({ plan: override, status: override === 'free' ? 'inactive' : 'active', developmentOverride: true, currentPeriodEnd: null, cancelAtPeriodEnd: false });
        const subscription = yield prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
        const scheduledEndPassed = Boolean((subscription === null || subscription === void 0 ? void 0 : subscription.cancelAtPeriodEnd) && subscription.currentPeriodEnd && subscription.currentPeriodEnd <= new Date());
        if (scheduledEndPassed && subscription && subscription.status !== 'canceled') {
            yield prisma.subscription.update({ where: { ownerKey: subscription.ownerKey }, data: { plan: 'free', status: 'canceled' } });
        }
        const active = !scheduledEndPassed && ((subscription === null || subscription === void 0 ? void 0 : subscription.status) === 'active' || (subscription === null || subscription === void 0 ? void 0 : subscription.status) === 'trialing');
        response.json({
            plan: active ? ((subscription === null || subscription === void 0 ? void 0 : subscription.plan) === 'standard' ? 'standard' : 'premium') : 'free',
            status: scheduledEndPassed ? 'canceled' : (_a = subscription === null || subscription === void 0 ? void 0 : subscription.status) !== null && _a !== void 0 ? _a : 'inactive',
            currentPeriodEnd: (_b = subscription === null || subscription === void 0 ? void 0 : subscription.currentPeriodEnd) !== null && _b !== void 0 ? _b : null,
            cancelAtPeriodEnd: (_c = subscription === null || subscription === void 0 ? void 0 : subscription.cancelAtPeriodEnd) !== null && _c !== void 0 ? _c : false,
        });
    }));
    // This route is loaded only when the account menu is opened. Keeping the
    // Stripe request out of /status prevents the desktop's regular refresh from
    // repeatedly calling Stripe.
    router.get('/manage', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const override = (0, devPlans_1.devPlan)(ownerKey(request));
        if (override)
            return response.json({ plan: override, status: override === 'free' ? 'inactive' : 'active', developmentOverride: true });
        const key = ownerKey(request);
        const localSubscription = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
        const active = (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) === 'active' || (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) === 'trialing';
        if (!active || !(localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.providerSubscriptionId)) {
            return response.json({ plan: 'free', status: (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) || 'inactive' });
        }
        const stripe = getStripe();
        if (!stripe)
            return response.json({ plan: localSubscription.plan, status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
        try {
            const subscription = yield stripe.subscriptions.retrieve(localSubscription.providerSubscriptionId);
            if (((_a = subscription.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey) !== key)
                return response.status(403).json({ error: 'Ta subskrypcja nie należy do tego użytkownika.' });
            const item = subscription.items.data[0];
            const details = yield paidInvoiceDetails(stripe, subscription.id);
            return response.json({
                plan: localSubscription.plan,
                status: subscription.status,
                interval: ((_b = item === null || item === void 0 ? void 0 : item.price.recurring) === null || _b === void 0 ? void 0 : _b.interval) || null,
                intervalCount: ((_c = item === null || item === void 0 ? void 0 : item.price.recurring) === null || _c === void 0 ? void 0 : _c.interval_count) || 1,
                amount: (item === null || item === void 0 ? void 0 : item.price.unit_amount) || (details === null || details === void 0 ? void 0 : details.amountPaid) || 0,
                currency: (item === null || item === void 0 ? void 0 : item.price.currency) || (details === null || details === void 0 ? void 0 : details.currency) || 'pln',
                renewalAt: subscription.cancel_at || subscription.cancel_at_period_end ? periodEnd(subscription.cancel_at || 0) || (details === null || details === void 0 ? void 0 : details.periodEnd) || localSubscription.currentPeriodEnd || null : (details === null || details === void 0 ? void 0 : details.periodEnd) || localSubscription.currentPeriodEnd || null,
                cancellationScheduled: Boolean(subscription.cancel_at || subscription.cancel_at_period_end),
                cancellationPolicy: 'Bieżący rozpoczęty miesiąc jest opłacony. Zwrot obejmuje wyłącznie pełne niewykorzystane miesiące.',
            });
        }
        catch (_d) {
            return response.json({ plan: localSubscription.plan, status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
        }
    }));
    router.get('/confirm', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const stripe = getStripe();
        const sessionId = typeof request.query.session_id === 'string' ? request.query.session_id : '';
        if (!stripe || !sessionId)
            return response.status(400).send('Brak identyfikatora sesji płatności.');
        try {
            const session = yield stripe.checkout.sessions.retrieve(sessionId);
            const sessionOwner = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey;
            // The success redirect does not carry the original Authorization header.
            // Stripe's signed session metadata is the source of truth for ownership.
            if (!sessionOwner)
                return response.status(403).send('Sesja płatności nie zawiera właściciela.');
            const currentOwner = sessionOwner;
            if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
                return response.status(402).send('Płatność nie została jeszcze potwierdzona.');
            }
            const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
            const customerId = typeof session.customer === 'string' ? session.customer : null;
            if (!subscriptionId)
                return response.status(409).send('Nie znaleziono subskrypcji dla tej płatności.');
            const stripeSubscription = yield stripe.subscriptions.retrieve(subscriptionId);
            if (((_b = stripeSubscription.metadata) === null || _b === void 0 ? void 0 : _b.ownerKey) !== currentOwner || !['active', 'trialing'].includes(stripeSubscription.status)) {
                return response.status(409).send('Subskrypcja nie jest aktywna.');
            }
            const existing = yield prisma.subscription.findUnique({ where: { ownerKey: currentOwner } });
            if ((existing === null || existing === void 0 ? void 0 : existing.providerSubscriptionId) !== subscriptionId && !(yield permitsReplacement(stripe, existing, currentOwner, ((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.replacesSubscriptionId) || null))) {
                return response.status(409).send('Konto ma już inną aktywną subskrypcję.');
            }
            yield prisma.subscription.upsert({
                where: { ownerKey: currentOwner },
                create: { ownerKey: currentOwner, providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: ((_d = session.metadata) === null || _d === void 0 ? void 0 : _d.plan) === 'standard' ? 'standard' : 'premium', status: stripeSubscription.status },
                update: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: ((_e = session.metadata) === null || _e === void 0 ? void 0 : _e.plan) === 'standard' ? 'standard' : 'premium', status: stripeSubscription.status, cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd((_f = stripeSubscription.items.data[0]) === null || _f === void 0 ? void 0 : _f.current_period_end) },
            });
            yield recordTransaction(prisma, {
                ownerKey: currentOwner,
                providerReference: session.id,
                providerSubscriptionId: subscriptionId,
                type: 'subscription_payment',
                status: 'succeeded',
                amount: session.amount_total || 0,
                currency: session.currency,
                description: 'Subskrypcja E‑Teczka Premium',
            });
            const planLabel = ((_g = session.metadata) === null || _g === void 0 ? void 0 : _g.plan) === 'standard' ? 'Standard' : 'Premium';
            response.type('html').send(`<!doctype html><meta charset="utf-8"><title>E‑Teczka — płatność potwierdzona</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność potwierdzona</h1><p>Plan ${planLabel} jest aktywny. Możesz zamknąć to okno i wrócić do E‑Teczki.</p><script>setTimeout(() => window.close(), 2500)</script></body>`);
        }
        catch (_h) {
            response.status(400).send('Nie udało się potwierdzić płatności.');
        }
    }));
    router.get('/cancel', (_request, response) => {
        response.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka — płatność anulowana</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność anulowana</h1><p>Nie pobrano opłaty. Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p></body>');
    });
    router.get('/portal-return', (_request, response) => {
        response.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka — powrót</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Wróć do E‑Teczki</h1><p>Możesz zamknąć to okno. Aplikacja sprawdzi status subskrypcji.</p></body>');
    });
    router.get('/cancel-preview', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        if ((0, devPlans_1.devPlan)(ownerKey(request)))
            return response.status(409).json({ error: 'W trybie testu planu wyłącz go przed zmianą płatności Stripe.' });
        const key = ownerKey(request);
        const local = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
        if (!(local === null || local === void 0 ? void 0 : local.providerSubscriptionId) || !['active', 'trialing'].includes(local.status))
            return response.status(404).json({ error: 'Brak aktywnej subskrypcji.' });
        const stripe = getStripe();
        if (!stripe)
            return response.status(503).json({ error: 'Płatności nie są skonfigurowane.' });
        try {
            const subscription = yield stripe.subscriptions.retrieve(local.providerSubscriptionId);
            if (((_a = subscription.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey) !== key)
                return response.status(403).json({ error: 'Ta subskrypcja nie należy do tego użytkownika.' });
            const details = yield paidInvoiceDetails(stripe, subscription.id);
            if (!details)
                return response.status(409).json({ error: 'Nie znaleziono opłaconej faktury.' });
            const now = new Date();
            const accessUntil = periodEnd(subscription.cancel_at || 0) || (0, refundPolicy_1.paidAccessEndsAt)(details, now);
            if (!accessUntil)
                return response.status(409).json({ error: 'Okres subskrypcji już się zakończył.' });
            const estimate = (0, refundPolicy_1.calculateUnusedMonthsRefund)(details, now);
            const ownerId = Number(response.locals.userId || 1);
            yield (0, tagOwnership_1.prepareTags)(prisma);
            const [documentCount, ownedTags] = yield Promise.all([prisma.document.count({ where: { folder: { ownerId } } }), (0, tagOwnership_1.tagIds)(prisma, ownerId)]);
            response.json({ accessUntil, refundedAmount: estimate.refundAmount, refundedMonths: estimate.refundedMonths, currency: details.currency, alreadyScheduled: Boolean(subscription.cancel_at || subscription.cancel_at_period_end), restrictedDocuments: Math.max(0, documentCount - planPolicy_1.PLAN_LIMITS.free.documents), inactiveTags: Math.max(0, ownedTags.length - planPolicy_1.PLAN_LIMITS.free.tags) });
        }
        catch (_b) {
            response.status(503).json({ error: 'Nie udało się pobrać rozliczenia ze Stripe.' });
        }
    }));
    router.post('/cancel-subscription', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a;
        if ((0, devPlans_1.devPlan)(ownerKey(request)))
            return response.status(409).json({ error: 'W trybie testu planu wyłącz go przed zmianą płatności Stripe.' });
        const stripe = getStripe();
        if (!stripe)
            return response.status(503).json({ error: 'Płatności nie są skonfigurowane.' });
        const key = ownerKey(request);
        const localSubscription = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
        const subscriptionId = localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.providerSubscriptionId;
        if (!subscriptionId)
            return response.status(404).json({ error: 'Nie znaleziono subskrypcji.' });
        try {
            const subscription = yield stripe.subscriptions.retrieve(subscriptionId);
            // A historical subscription can be refunded only by its owner. This also
            // allows recovery when it was cancelled before the refund code was fixed.
            if (((_a = subscription.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey) !== key)
                return response.status(403).json({ error: 'Ta subskrypcja nie należy do tego użytkownika.' });
            const details = yield paidInvoiceDetails(stripe, subscription.id);
            if (!details)
                return response.status(409).json({ error: 'Nie znaleziono opłaconej faktury tej subskrypcji.' });
            const now = new Date();
            const { refundedMonths, refundAmount } = (0, refundPolicy_1.calculateUnusedMonthsRefund)(details, now);
            const accessUntil = periodEnd(subscription.cancel_at || 0) || (0, refundPolicy_1.paidAccessEndsAt)(details, now);
            if (!accessUntil)
                return response.status(409).json({ error: 'Okres subskrypcji już się zakończył.' });
            const existingRefund = yield prisma.billingTransaction.findFirst({
                where: { providerSubscriptionId: subscription.id, type: 'refund', status: { in: ['succeeded', 'pending'] } },
            });
            // Stop renewal first. Stripe keeps the paid part of the current month active.
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
                    return response.status(409).json({ error: 'Nie znaleziono płatności do zwrotu.' });
                const refund = yield stripe.refunds.create({ payment_intent: details.paymentIntentId, amount: refundAmount, reason: 'requested_by_customer' }, { idempotencyKey: `eteczka-refund-${subscription.id}-${details.invoice.id}` });
                refundId = refund.id;
                yield recordTransaction(prisma, {
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
                plan: localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.plan,
                accessUntil,
                refundedAmount: existingRefund ? existingRefund.amount : refundAmount,
                refundedMonths,
                refundId,
            });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Nie udało się anulować subskrypcji.';
            return response.status(500).json({ error: message });
        }
    }));
    router.get('/history', (request, response) => __awaiter(this, void 0, void 0, function* () {
        const key = ownerKey(request);
        let transactions = yield prisma.billingTransaction.findMany({
            where: { ownerKey: key },
            orderBy: { occurredAt: 'desc' },
            take: 100,
        });
        // Backfill a payment created before local transaction history was enabled.
        if (transactions.length === 0) {
            const localSubscription = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
            const stripe = getStripe();
            if (stripe && (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.providerSubscriptionId)) {
                try {
                    const subscription = yield stripe.subscriptions.retrieve(localSubscription.providerSubscriptionId, { expand: ['latest_invoice'] });
                    const invoice = typeof subscription.latest_invoice === 'object' && subscription.latest_invoice ? subscription.latest_invoice : null;
                    if (invoice && typeof invoice.id === 'string') {
                        yield recordTransaction(prisma, {
                            ownerKey: key,
                            providerReference: invoice.id,
                            providerSubscriptionId: subscription.id,
                            type: 'subscription_payment',
                            status: invoice.status === 'paid' ? 'succeeded' : String(invoice.status || 'open'),
                            amount: invoice.amount_paid || 0,
                            currency: invoice.currency,
                            description: 'Subskrypcja E‑Teczka Premium',
                        });
                        transactions = yield prisma.billingTransaction.findMany({ where: { ownerKey: key }, orderBy: { occurredAt: 'desc' }, take: 100 });
                    }
                }
                catch (_a) { }
            }
        }
        response.json(transactions);
    }));
    router.post('/sync-upgrade', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e;
        if ((0, devPlans_1.devPlan)(ownerKey(request)))
            return response.status(409).json({ error: 'Wyłącz test planu przed zmianą subskrypcji.' });
        const stripe = getStripe();
        const existing = yield prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
        if (!stripe || !(existing === null || existing === void 0 ? void 0 : existing.providerSubscriptionId) || !existing.providerCustomerId)
            return response.status(404).json({ error: 'Nie znaleziono subskrypcji.' });
        try {
            const subscription = yield stripe.subscriptions.retrieve(existing.providerSubscriptionId);
            const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
            const price = (_b = (_a = subscription.items.data[0]) === null || _a === void 0 ? void 0 : _a.price) === null || _b === void 0 ? void 0 : _b.id;
            if (((_c = subscription.metadata) === null || _c === void 0 ? void 0 : _c.ownerKey) !== ownerKey(request) || customer !== existing.providerCustomerId || !['active', 'trialing'].includes(subscription.status) || !price || ![process.env.STRIPE_PRICE_MONTHLY, process.env.STRIPE_PRICE_YEARLY].includes(price))
                return response.json({ upgraded: false });
            const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : (_d = subscription.latest_invoice) === null || _d === void 0 ? void 0 : _d.id;
            if (!invoiceId || (yield stripe.invoices.retrieve(invoiceId)).status !== 'paid')
                return response.json({ upgraded: false });
            yield prisma.subscription.updateMany({ where: { ownerKey: ownerKey(request), providerSubscriptionId: subscription.id }, data: { plan: 'premium', status: subscription.status, currentPeriodEnd: periodEnd((_e = subscription.items.data[0]) === null || _e === void 0 ? void 0 : _e.current_period_end), cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) } });
            return response.json({ upgraded: true });
        }
        catch (_f) {
            return response.status(503).json({ error: 'Nie udało się potwierdzić zmiany planu w Stripe.' });
        }
    }));
    router.post('/checkout', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f;
        if (!options.allowLegacyCheckout)
            return response.status(503).json({ code: 'GOOGLE_PLAY_PENDING', error: 'Zakupy przez Google Play są w przygotowaniu. Nowe płatności Stripe są wyłączone.' });
        if ((0, devPlans_1.devPlan)(ownerKey(request)))
            return response.status(409).json({ error: 'W trybie testu planu wyłącz go przed zmianą płatności Stripe.' });
        const stripe = getStripe();
        if (!stripe)
            return response.status(503).json({ error: 'Płatności testowe nie są jeszcze skonfigurowane.' });
        const existing = yield prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
        if ((existing === null || existing === void 0 ? void 0 : existing.plan) === 'standard' && ['active', 'trialing'].includes(existing.status) && !existing.cancelAtPeriodEnd && ((_a = request.body) === null || _a === void 0 ? void 0 : _a.plan) === 'premium') {
            const price = ((_b = request.body) === null || _b === void 0 ? void 0 : _b.interval) === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY;
            if (!price || !existing.providerSubscriptionId || !existing.providerCustomerId)
                return response.status(503).json({ error: 'Zmiana planu wymaga skonfigurowanej ceny Premium i aktywnej subskrypcji Stripe.' });
            try {
                const subscription = yield stripe.subscriptions.retrieve(existing.providerSubscriptionId);
                const customer = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
                if (((_c = subscription.metadata) === null || _c === void 0 ? void 0 : _c.ownerKey) !== ownerKey(request) || customer !== existing.providerCustomerId || subscription.items.data.length !== 1 || !['active', 'trialing'].includes(subscription.status))
                    return response.status(409).json({ error: 'Nie można bezpiecznie potwierdzić obecnej subskrypcji.' });
                const portal = yield stripe.billingPortal.sessions.create({ customer, return_url: `${(0, billingReturnUrl_1.billingReturnBase)(request.socket.localAddress)}/api/billing/portal-return`, flow_data: { type: 'subscription_update_confirm', subscription_update_confirm: { subscription: subscription.id, items: [{ id: subscription.items.data[0].id, price, quantity: subscription.items.data[0].quantity || 1 }] } } });
                return response.json({ url: portal.url, sessionId: '', kind: 'upgrade' });
            }
            catch (error) {
                console.error('[billing] Nie udało się przygotować zmiany planu:', error instanceof Error ? error.message : 'Stripe error');
                return response.status(503).json({ error: 'Nie udało się przygotować zmiany planu w Stripe. Sprawdź konfigurację portalu klienta i ceny Premium.' });
            }
        }
        try {
            if (!(yield permitsReplacement(stripe, existing, ownerKey(request))))
                return response.status(409).json({ error: 'Masz aktywną subskrypcję bez zaplanowanego anulowania.' });
        }
        catch (_g) {
            return response.status(503).json({ error: 'Nie udało się sprawdzić anulowania w Stripe. Spróbuj ponownie.' });
        }
        if ((existing === null || existing === void 0 ? void 0 : existing.cancelAtPeriodEnd) && ['active', 'trialing'].includes(existing.status) && ((_d = request.body) === null || _d === void 0 ? void 0 : _d.acceptReplacement) !== true)
            return response.status(409).json({ error: 'Przed nową płatnością potwierdź rozpoczęcie nowego planu i opłatę za niego.' });
        const plan = ((_e = request.body) === null || _e === void 0 ? void 0 : _e.plan) === 'standard' ? 'standard' : 'premium';
        const interval = ((_f = request.body) === null || _f === void 0 ? void 0 : _f.interval) === 'yearly' ? 'yearly' : 'monthly';
        const price = plan === 'standard'
            ? (interval === 'yearly' ? process.env.STRIPE_STANDARD_PRICE_YEARLY : process.env.STRIPE_STANDARD_PRICE_MONTHLY)
            : (interval === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY);
        const testKey = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');
        if (!price && !testKey)
            return response.status(503).json({ error: `Brak ceny dla planu ${interval}.` });
        // In Stripe test mode we can start checkout before dashboard price IDs are
        // copied to .env. Production/live mode always requires an explicit price ID.
        const lineItem = price
            ? { price, quantity: 1 }
            : {
                price_data: {
                    currency: 'pln',
                    unit_amount: plan === 'standard' ? (interval === 'yearly' ? 4990 : 499) : (interval === 'yearly' ? 9990 : 999),
                    recurring: { interval: interval === 'yearly' ? 'year' : 'month' },
                    product_data: { name: `E‑Teczka ${plan === 'standard' ? 'Standard' : 'Premium'}` },
                },
                quantity: 1,
            };
        const returnBase = (0, billingReturnUrl_1.billingReturnBase)(request.socket.localAddress);
        const replacesSubscriptionId = (existing === null || existing === void 0 ? void 0 : existing.cancelAtPeriodEnd) && ['active', 'trialing'].includes(existing.status) ? existing.providerSubscriptionId || '' : '';
        const checkoutParams = {
            mode: 'subscription',
            line_items: [lineItem],
            success_url: process.env.ETECZKA_BILLING_SUCCESS_URL || `${returnBase}/api/billing/confirm?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: process.env.ETECZKA_BILLING_CANCEL_URL || `${returnBase}/api/billing/cancel`,
            metadata: { ownerKey: ownerKey(request), plan, replacesSubscriptionId },
            subscription_data: { metadata: { ownerKey: ownerKey(request), plan } },
        };
        // Test accounts may have Managed Payments enabled globally. The local
        // Checkout flow does not use it, so explicitly disable it for this session.
        checkoutParams.managed_payments = { enabled: false };
        const session = yield stripe.checkout.sessions.create(checkoutParams);
        return response.json({ url: session.url, sessionId: session.id });
    }));
    return router;
}
function createBillingWebhookHandler(prisma, getStripe = stripeClient) {
    return (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q;
        const stripe = getStripe();
        const signature = request.header('stripe-signature');
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!stripe || !signature || !secret)
            return response.status(503).json({ error: 'Webhook Stripe nie jest skonfigurowany.' });
        let event;
        try {
            event = stripe.webhooks.constructEvent(request.body, signature, secret);
        }
        catch (_r) {
            return response.status(400).json({ error: 'Nieprawidłowy podpis webhooka Stripe.' });
        }
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
            const customerId = typeof session.customer === 'string' ? session.customer : null;
            const key = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey;
            if (!key || !subscriptionId || (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required'))
                return response.json({ received: true });
            const stripeSubscription = yield stripe.subscriptions.retrieve(subscriptionId);
            if (((_b = stripeSubscription.metadata) === null || _b === void 0 ? void 0 : _b.ownerKey) !== key || !['active', 'trialing'].includes(stripeSubscription.status))
                return response.json({ received: true });
            const current = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
            if ((current === null || current === void 0 ? void 0 : current.providerSubscriptionId) !== subscriptionId && !(yield permitsReplacement(stripe, current, key, ((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.replacesSubscriptionId) || null)))
                return response.json({ received: true });
            if (key)
                yield prisma.subscription.upsert({
                    where: { ownerKey: key },
                    create: { ownerKey: key, providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: ((_d = session.metadata) === null || _d === void 0 ? void 0 : _d.plan) === 'standard' ? 'standard' : 'premium', status: stripeSubscription.status },
                    update: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: ((_e = session.metadata) === null || _e === void 0 ? void 0 : _e.plan) === 'standard' ? 'standard' : 'premium', status: stripeSubscription.status, cancelAtPeriodEnd: false, currentPeriodEnd: periodEnd((_f = stripeSubscription.items.data[0]) === null || _f === void 0 ? void 0 : _f.current_period_end) },
                });
            if (key)
                yield recordTransaction(prisma, {
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
            const eventSubscription = event.data.object;
            // Stripe may deliver events out of order; use the current provider state.
            const subscription = yield stripe.subscriptions.retrieve(eventSubscription.id);
            const key = (_g = subscription.metadata) === null || _g === void 0 ? void 0 : _g.ownerKey;
            if (key) {
                const current = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
                if ((current === null || current === void 0 ? void 0 : current.providerSubscriptionId) && current.providerSubscriptionId !== subscription.id)
                    return response.json({ received: true });
            }
            const cancellationTime = periodEnd(subscription.cancel_at || (subscription.cancel_at_period_end ? (_h = subscription.items.data[0]) === null || _h === void 0 ? void 0 : _h.current_period_end : null));
            const periodFinish = periodEnd((_j = subscription.items.data[0]) === null || _j === void 0 ? void 0 : _j.current_period_end);
            const actualPrice = (_l = (_k = subscription.items.data[0]) === null || _k === void 0 ? void 0 : _k.price) === null || _l === void 0 ? void 0 : _l.id;
            const pricePlan = actualPrice && [process.env.STRIPE_PRICE_MONTHLY, process.env.STRIPE_PRICE_YEARLY].includes(actualPrice) ? 'premium' : actualPrice && [process.env.STRIPE_STANDARD_PRICE_MONTHLY, process.env.STRIPE_STANDARD_PRICE_YEARLY].includes(actualPrice) ? 'standard' : (((_m = subscription.metadata) === null || _m === void 0 ? void 0 : _m.plan) === 'standard' ? 'standard' : 'premium');
            if (key && subscription.status !== 'canceled' && pricePlan === 'premium' && ((_o = subscription.metadata) === null || _o === void 0 ? void 0 : _o.plan) === 'standard') {
                const invoiceId = typeof subscription.latest_invoice === 'string' ? subscription.latest_invoice : (_p = subscription.latest_invoice) === null || _p === void 0 ? void 0 : _p.id;
                if (!invoiceId || (yield stripe.invoices.retrieve(invoiceId)).status !== 'paid')
                    return response.json({ received: true });
            }
            if (key)
                yield prisma.subscription.upsert({
                    where: { ownerKey: key },
                    create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: subscription.status === 'canceled' ? 'free' : pricePlan, status: subscription.status, currentPeriodEnd: cancellationTime || periodFinish, cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) },
                    update: { providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, plan: subscription.status === 'canceled' ? 'free' : pricePlan, status: subscription.status, currentPeriodEnd: cancellationTime || periodFinish, cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) },
                });
        }
        if (event.type === 'invoice.payment_failed') {
            const invoice = event.data.object;
            const subscriptionReference = invoice.subscription;
            const subscriptionId = typeof subscriptionReference === 'string' ? subscriptionReference : subscriptionReference === null || subscriptionReference === void 0 ? void 0 : subscriptionReference.id;
            if (subscriptionId) {
                try {
                    const subscription = yield stripe.subscriptions.retrieve(subscriptionId);
                    const key = (_q = subscription.metadata) === null || _q === void 0 ? void 0 : _q.ownerKey;
                    if (!key || !['past_due', 'unpaid', 'incomplete'].includes(subscription.status))
                        return response.json({ received: true });
                    const current = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
                    if ((current === null || current === void 0 ? void 0 : current.providerSubscriptionId) && current.providerSubscriptionId !== subscription.id)
                        return response.json({ received: true });
                    if (key)
                        yield prisma.subscription.upsert({
                            where: { ownerKey: key },
                            create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: 'free', status: subscription.status },
                            update: { plan: 'free', status: subscription.status },
                        });
                }
                catch (_s) {
                    return response.status(503).json({ error: 'Nie udało się sprawdzić subskrypcji.' });
                }
            }
        }
        return response.json({ received: true });
    });
}
