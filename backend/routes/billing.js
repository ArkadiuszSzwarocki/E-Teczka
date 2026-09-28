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
function stripeClient() {
    const key = process.env.STRIPE_SECRET_KEY;
    return key ? new stripe_1.default(key) : null;
}
function ownerKey(request) {
    var _a;
    return String(((_a = request.res) === null || _a === void 0 ? void 0 : _a.locals.billingOwnerKey) || 'desktop-local');
}
function periodEnd(unixSeconds) {
    return typeof unixSeconds === 'number' ? new Date(unixSeconds * 1000) : null;
}
function calendarMonthIndex(date) {
    return date.getUTCFullYear() * 12 + date.getUTCMonth();
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
function calculateUnusedMonthsRefund(details, now) {
    if (!details.periodStart || !details.periodEnd || details.amountPaid <= 0) {
        return { billedMonths: 0, refundedMonths: 0, refundAmount: 0 };
    }
    const billedMonths = Math.max(1, calendarMonthIndex(details.periodEnd) - calendarMonthIndex(details.periodStart));
    // The month in which the cancellation is requested is consumed. Only whole
    // calendar months after it are refundable, as agreed for E‑Teczka plans.
    const refundedMonths = Math.max(0, Math.min(billedMonths - 1, calendarMonthIndex(details.periodEnd) - calendarMonthIndex(now) - 1));
    return {
        billedMonths,
        refundedMonths,
        refundAmount: Math.min(details.amountPaid, Math.round((details.amountPaid * refundedMonths) / billedMonths)),
    };
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
function createBillingRouter(prisma) {
    const router = express_1.default.Router();
    router.get('/status', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const subscription = yield prisma.subscription.findUnique({ where: { ownerKey: ownerKey(request) } });
        const active = (subscription === null || subscription === void 0 ? void 0 : subscription.status) === 'active' || (subscription === null || subscription === void 0 ? void 0 : subscription.status) === 'trialing';
        response.json({
            plan: active ? ((subscription === null || subscription === void 0 ? void 0 : subscription.plan) === 'standard' ? 'standard' : 'premium') : 'free',
            status: (_a = subscription === null || subscription === void 0 ? void 0 : subscription.status) !== null && _a !== void 0 ? _a : 'inactive',
            currentPeriodEnd: (_b = subscription === null || subscription === void 0 ? void 0 : subscription.currentPeriodEnd) !== null && _b !== void 0 ? _b : null,
            cancelAtPeriodEnd: (_c = subscription === null || subscription === void 0 ? void 0 : subscription.cancelAtPeriodEnd) !== null && _c !== void 0 ? _c : false,
        });
    }));
    // This route is loaded only when the account menu is opened. Keeping the
    // Stripe request out of /status prevents the desktop's regular refresh from
    // repeatedly calling Stripe.
    router.get('/manage', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const key = ownerKey(request);
        const localSubscription = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
        const active = (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) === 'active' || (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) === 'trialing';
        if (!active || !(localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.providerSubscriptionId)) {
            return response.json({ plan: 'free', status: (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) || 'inactive' });
        }
        const stripe = stripeClient();
        if (!stripe)
            return response.json({ plan: 'premium', status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
        try {
            const subscription = yield stripe.subscriptions.retrieve(localSubscription.providerSubscriptionId);
            if (((_a = subscription.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey) !== key)
                return response.status(403).json({ error: 'Ta subskrypcja nie należy do tego użytkownika.' });
            const item = subscription.items.data[0];
            const details = yield paidInvoiceDetails(stripe, subscription.id);
            return response.json({
                plan: 'premium',
                status: subscription.status,
                interval: ((_b = item === null || item === void 0 ? void 0 : item.price.recurring) === null || _b === void 0 ? void 0 : _b.interval) || null,
                intervalCount: ((_c = item === null || item === void 0 ? void 0 : item.price.recurring) === null || _c === void 0 ? void 0 : _c.interval_count) || 1,
                amount: (item === null || item === void 0 ? void 0 : item.price.unit_amount) || (details === null || details === void 0 ? void 0 : details.amountPaid) || 0,
                currency: (item === null || item === void 0 ? void 0 : item.price.currency) || (details === null || details === void 0 ? void 0 : details.currency) || 'pln',
                renewalAt: (details === null || details === void 0 ? void 0 : details.periodEnd) || localSubscription.currentPeriodEnd || null,
                cancellationPolicy: 'Bieżący rozpoczęty miesiąc jest opłacony. Zwrot obejmuje wyłącznie pełne niewykorzystane miesiące.',
            });
        }
        catch (_d) {
            return response.json({ plan: 'premium', status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
        }
    }));
    router.get('/confirm', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const stripe = stripeClient();
        const sessionId = typeof request.query.session_id === 'string' ? request.query.session_id : '';
        if (!stripe || !sessionId)
            return response.status(400).send('Brak identyfikatora sesji płatności.');
        try {
            const session = yield stripe.checkout.sessions.retrieve(sessionId);
            const sessionOwner = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey;
            const currentOwner = ownerKey(request);
            if (!sessionOwner || sessionOwner !== currentOwner)
                return response.status(403).send('Sesja płatności nie należy do tego użytkownika.');
            if (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required') {
                return response.status(402).send('Płatność nie została jeszcze potwierdzona.');
            }
            const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
            const customerId = typeof session.customer === 'string' ? session.customer : null;
            yield prisma.subscription.upsert({
                where: { ownerKey: currentOwner },
                create: { ownerKey: currentOwner, providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: ((_b = session.metadata) === null || _b === void 0 ? void 0 : _b.plan) === 'standard' ? 'standard' : 'premium', status: 'active' },
                update: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: ((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.plan) === 'standard' ? 'standard' : 'premium', status: 'active' },
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
            response.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka — płatność potwierdzona</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność potwierdzona</h1><p>Plan Premium jest aktywny. Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p></body>');
        }
        catch (_d) {
            response.status(400).send('Nie udało się potwierdzić płatności.');
        }
    }));
    router.get('/cancel', (_request, response) => {
        response.type('html').send('<!doctype html><meta charset="utf-8"><title>E‑Teczka — płatność anulowana</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność anulowana</h1><p>Nie pobrano opłaty. Możesz zamknąć tę kartę i wrócić do E‑Teczki.</p></body>');
    });
    router.post('/cancel-subscription', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const stripe = stripeClient();
        if (!stripe)
            return response.status(503).json({ error: 'Płatności nie są skonfigurowane.' });
        const key = ownerKey(request);
        const localSubscription = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
        const requestedId = typeof ((_a = request.body) === null || _a === void 0 ? void 0 : _a.subscriptionId) === 'string' ? request.body.subscriptionId.trim() : '';
        const subscriptionId = requestedId || (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.providerSubscriptionId);
        if (!subscriptionId)
            return response.status(404).json({ error: 'Nie znaleziono subskrypcji.' });
        try {
            const subscription = yield stripe.subscriptions.retrieve(subscriptionId);
            // A historical subscription can be refunded only by its owner. This also
            // allows recovery when it was cancelled before the refund code was fixed.
            if (((_b = subscription.metadata) === null || _b === void 0 ? void 0 : _b.ownerKey) !== key)
                return response.status(403).json({ error: 'Ta subskrypcja nie należy do tego użytkownika.' });
            const details = yield paidInvoiceDetails(stripe, subscription.id);
            if (!details)
                return response.status(409).json({ error: 'Nie znaleziono opłaconej faktury tej subskrypcji.' });
            const { refundedMonths, refundAmount } = calculateUnusedMonthsRefund(details, new Date());
            const existingRefund = yield prisma.billingTransaction.findFirst({
                where: { providerSubscriptionId: subscription.id, type: 'refund', status: { in: ['succeeded', 'pending'] } },
            });
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
            if (subscription.status !== 'canceled')
                yield stripe.subscriptions.cancel(subscription.id, { invoice_now: false, prorate: false });
            const affectsCurrentPlan = (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.providerSubscriptionId) === subscription.id;
            if (affectsCurrentPlan)
                yield prisma.subscription.update({
                    where: { ownerKey: key },
                    data: { plan: 'free', status: 'canceled', cancelAtPeriodEnd: false },
                });
            return response.json({
                plan: affectsCurrentPlan ? 'free' : ((localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) === 'active' || (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) === 'trialing' ? 'premium' : 'free'),
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
            const stripe = stripeClient();
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
    router.post('/checkout', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const stripe = stripeClient();
        if (!stripe)
            return response.status(503).json({ error: 'Płatności testowe nie są jeszcze skonfigurowane.' });
        const plan = ((_a = request.body) === null || _a === void 0 ? void 0 : _a.plan) === 'standard' ? 'standard' : 'premium';
        const interval = ((_b = request.body) === null || _b === void 0 ? void 0 : _b.interval) === 'yearly' ? 'yearly' : 'monthly';
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
        const checkoutParams = {
            mode: 'subscription',
            line_items: [lineItem],
            success_url: process.env.ETECZKA_BILLING_SUCCESS_URL || 'http://localhost:3000/api/billing/confirm?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: process.env.ETECZKA_BILLING_CANCEL_URL || 'http://localhost:3000/api/billing/cancel',
            metadata: { ownerKey: ownerKey(request), plan },
            subscription_data: { metadata: { ownerKey: ownerKey(request), plan } },
        };
        // Test accounts may have Managed Payments enabled globally. The local
        // Checkout flow does not use it, so explicitly disable it for this session.
        checkoutParams.managed_payments = { enabled: false };
        const session = yield stripe.checkout.sessions.create(checkoutParams);
        return response.json({ url: session.url });
    }));
    return router;
}
function createBillingWebhookHandler(prisma) {
    return (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g;
        const stripe = stripeClient();
        const signature = request.header('stripe-signature');
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!stripe || !signature || !secret)
            return response.status(503).json({ error: 'Webhook Stripe nie jest skonfigurowany.' });
        let event;
        try {
            event = stripe.webhooks.constructEvent(request.body, signature, secret);
        }
        catch (_h) {
            return response.status(400).json({ error: 'Nieprawidłowy podpis webhooka Stripe.' });
        }
        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;
            const customerId = typeof session.customer === 'string' ? session.customer : null;
            const key = (_a = session.metadata) === null || _a === void 0 ? void 0 : _a.ownerKey;
            if (key)
                yield prisma.subscription.upsert({
                    where: { ownerKey: key },
                    create: { ownerKey: key, providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: ((_b = session.metadata) === null || _b === void 0 ? void 0 : _b.plan) === 'standard' ? 'standard' : 'premium', status: 'active' },
                    update: { providerCustomerId: customerId, providerSubscriptionId: subscriptionId, plan: ((_c = session.metadata) === null || _c === void 0 ? void 0 : _c.plan) === 'standard' ? 'standard' : 'premium', status: 'active' },
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
            const subscription = event.data.object;
            const key = (_d = subscription.metadata) === null || _d === void 0 ? void 0 : _d.ownerKey;
            if (key)
                yield prisma.subscription.upsert({
                    where: { ownerKey: key },
                    create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: event.type.endsWith('deleted') ? 'free' : (((_e = subscription.metadata) === null || _e === void 0 ? void 0 : _e.plan) === 'standard' ? 'standard' : 'premium'), status: event.type.endsWith('deleted') ? 'canceled' : subscription.status, currentPeriodEnd: periodEnd(subscription.current_period_end), cancelAtPeriodEnd: subscription.cancel_at_period_end },
                    update: { providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, plan: event.type.endsWith('deleted') ? 'free' : (((_f = subscription.metadata) === null || _f === void 0 ? void 0 : _f.plan) === 'standard' ? 'standard' : 'premium'), status: event.type.endsWith('deleted') ? 'canceled' : subscription.status, currentPeriodEnd: periodEnd(subscription.current_period_end), cancelAtPeriodEnd: subscription.cancel_at_period_end },
                });
        }
        if (event.type === 'invoice.payment_failed') {
            const invoice = event.data.object;
            const subscriptionReference = invoice.subscription;
            const subscriptionId = typeof subscriptionReference === 'string' ? subscriptionReference : subscriptionReference === null || subscriptionReference === void 0 ? void 0 : subscriptionReference.id;
            if (subscriptionId) {
                try {
                    const subscription = yield stripe.subscriptions.retrieve(subscriptionId);
                    const key = (_g = subscription.metadata) === null || _g === void 0 ? void 0 : _g.ownerKey;
                    if (key)
                        yield prisma.subscription.upsert({
                            where: { ownerKey: key },
                            create: { ownerKey: key, providerCustomerId: typeof subscription.customer === 'string' ? subscription.customer : null, providerSubscriptionId: subscription.id, plan: 'free', status: 'past_due' },
                            update: { plan: 'free', status: 'past_due' },
                        });
                }
                catch (_j) {
                    // Stripe will retry delivery. A transient lookup failure must not
                    // cause the webhook endpoint to fail permanently.
                }
            }
        }
        return response.json({ received: true });
    });
}
