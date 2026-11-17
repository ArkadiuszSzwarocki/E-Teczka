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
const billingReturnUrl_1 = require("../services/billingReturnUrl");
const devPlans_1 = require("../services/devPlans");
const centralPlanLedger_1 = require("../services/centralPlanLedger");
const planUsage_1 = require("../services/planUsage");
const centralEntitlements_1 = require("../services/centralEntitlements");
const ocrPremium_1 = require("../services/ocrPremium");
const planCatalog_1 = require("../services/planCatalog");
const centralAccountLink_1 = require("../services/centralAccountLink");
const stripeBilling_1 = require("../services/stripeBilling");
function ownerKey(request) {
    var _a;
    return String(((_a = request.res) === null || _a === void 0 ? void 0 : _a.locals.billingOwnerKey) || 'desktop-local');
}
function createBillingRouter(prisma, getStripe = stripeBilling_1.defaultStripeClient, options = {}) {
    const router = express_1.default.Router();
    router.get('/catalog', (_request, response) => __awaiter(this, void 0, void 0, function* () {
        const centralOrigin = (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
        if (centralOrigin) {
            try {
                const res = yield fetch(`${centralOrigin}/catalog`, { redirect: 'error', signal: AbortSignal.timeout(3000) });
                if (res.ok)
                    (0, planCatalog_1.applyCentralCatalog)(yield res.json());
            }
            catch ( /* Fallback to cached/local catalog when central server is unreachable */_a) { /* Fallback to cached/local catalog when central server is unreachable */ }
        }
        const catalog = (0, planCatalog_1.getCatalog)();
        const now = new Date();
        response.json({
            catalog,
            quotes: {
                standard: { monthly: (0, planCatalog_1.quote)('standard', 'monthly', now, catalog), yearly: (0, planCatalog_1.quote)('standard', 'yearly', now, catalog) },
                premium: { monthly: (0, planCatalog_1.quote)('premium', 'monthly', now, catalog), yearly: (0, planCatalog_1.quote)('premium', 'yearly', now, catalog) },
                family: { monthly: (0, planCatalog_1.quote)('family', 'monthly', now, catalog), yearly: (0, planCatalog_1.quote)('family', 'yearly', now, catalog) },
                business: { monthly: (0, planCatalog_1.quote)('business', 'monthly', now, catalog), yearly: (0, planCatalog_1.quote)('business', 'yearly', now, catalog) },
            },
        });
    }));
    router.get('/usage', (_request, response) => __awaiter(this, void 0, void 0, function* () {
        try {
            response.json(yield (0, planUsage_1.getPlanUsage)(prisma, (0, ocrPremium_1.ocrOwnerKey)(response), Number(response.locals.userId || 1)));
        }
        catch (error) {
            console.error('[billing] Nie udało się pobrać limitów:', error);
            response.status(500).json({ error: 'Nie udało się pobrać wykorzystania planu.' });
        }
    }));
    router.post('/offline', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const userId = (0, centralPlanLedger_1.centralOwner)((0, ocrPremium_1.ocrOwnerKey)(response));
        if (!userId)
            return response.status(400).json({ error: 'Zaloguj się na konto E‑Teczki, aby pobrać przydział offline.' });
        try {
            if (((_a = request.body) === null || _a === void 0 ? void 0 : _a.budgets) !== undefined && (typeof request.body.budgets !== 'object' || request.body.budgets === null || Array.isArray(request.body.budgets)))
                throw new Error('Nieprawidłowe przydziały offline.');
            yield (0, centralEntitlements_1.centralEntitlement)(userId, true);
            return response.json(yield (0, centralPlanLedger_1.prepareCentralOffline)(prisma, userId, (_b = request.body) === null || _b === void 0 ? void 0 : _b.budgets));
        }
        catch (error) {
            return response.status(409).json({ error: error.message });
        }
    }));
    router.get('/status', (request, response) => __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const override = (0, devPlans_1.devPlan)(ownerKey(request));
        if (override)
            return response.json({ plan: override, status: override === 'free' ? 'inactive' : 'active', developmentOverride: true, currentPeriodEnd: null, cancelAtPeriodEnd: false });
        const centralId = /^user:(\d+)$/.exec(ownerKey(request));
        const central = centralId ? yield (0, centralEntitlements_1.centralEntitlement)(Number(centralId[1])) : null;
        if (central)
            return response.json({ plan: central.plan, status: central.plan === 'free' ? 'inactive' : 'active', currentPeriodEnd: central.validUntil ? new Date(central.validUntil) : null, cancelAtPeriodEnd: false, source: 'central', offlineUntil: central.expiresAt ? new Date(central.expiresAt) : null, deviceBlocked: central.blocked });
        if (centralId && (yield (0, centralEntitlements_1.hasCentralLink)(prisma, Number(centralId[1]))))
            return response.json({ plan: 'free', status: 'inactive', source: 'central', registrationRequired: true });
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
    router.get('/manage', (request, response) => __awaiter(this, void 0, void 0, function* () {
        const override = (0, devPlans_1.devPlan)(ownerKey(request));
        if (override)
            return response.json({ plan: override, status: override === 'free' ? 'inactive' : 'active', developmentOverride: true });
        const centralId = /^user:(\d+)$/.exec(ownerKey(request));
        const central = centralId ? yield (0, centralEntitlements_1.centralEntitlement)(Number(centralId[1])) : null;
        if (central)
            return response.json({ plan: central.plan, status: central.plan === 'free' ? 'inactive' : 'active', source: 'central', renewalAt: central.validUntil ? new Date(central.validUntil) : null });
        const key = ownerKey(request);
        const localSubscription = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
        const active = (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) === 'active' || (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) === 'trialing';
        if (!active || !(localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.providerSubscriptionId))
            return response.json({ plan: 'free', status: (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.status) || 'inactive' });
        const stripe = getStripe();
        if (!stripe)
            return response.json({ plan: localSubscription.plan, status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
        try {
            return response.json(yield (0, stripeBilling_1.getStripeManageSummary)(stripe, key, localSubscription));
        }
        catch (error) {
            if (error instanceof stripeBilling_1.BillingHttpError)
                return response.status(error.statusCode).json({ error: error.message });
            return response.json({ plan: localSubscription.plan, status: localSubscription.status, renewalAt: localSubscription.currentPeriodEnd });
        }
    }));
    router.get('/confirm', (request, response) => __awaiter(this, void 0, void 0, function* () {
        const stripe = getStripe();
        const sessionId = typeof request.query.session_id === 'string' ? request.query.session_id : '';
        if (!stripe || !sessionId)
            return response.status(400).send('Brak identyfikatora sesji płatności.');
        try {
            const session = yield stripe.checkout.sessions.retrieve(sessionId);
            const plan = yield (0, stripeBilling_1.applyCheckoutSession)(prisma, stripe, session, true);
            const planLabel = plan === 'standard' ? 'Standard' : 'Premium';
            response.type('html').send(`<!doctype html><meta charset="utf-8"><title>E‑Teczka — płatność potwierdzona</title><body style="font-family:Arial;background:#0f172a;color:#e2e8f0;padding:40px"><h1>Płatność potwierdzona</h1><p>Plan ${planLabel} jest aktywny. Możesz zamknąć to okno i wrócić do E‑Teczki.</p><script>setTimeout(() => window.close(), 2500)</script></body>`);
        }
        catch (error) {
            if (error instanceof stripeBilling_1.BillingHttpError)
                return response.status(error.statusCode).send(error.message);
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
        const user = /^user:(\d+)$/.exec(ownerKey(request));
        if (user && (0, centralEntitlements_1.centralDeviceRegistered)(Number(user[1])))
            return response.status(409).json({ error: 'Plan konta jest zarządzany centralnie. Subskrypcję Google Play możesz zmienić lub anulować w Google Play.', managementUrl: 'https://play.google.com/store/account/subscriptions' });
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
            return response.json(yield (0, stripeBilling_1.previewStripeCancellation)(prisma, stripe, key, Number(response.locals.userId || 1), local.providerSubscriptionId));
        }
        catch (error) {
            if (error instanceof stripeBilling_1.BillingHttpError)
                return response.status(error.statusCode).json({ error: error.message });
            return response.status(503).json({ error: 'Nie udało się pobrać rozliczenia ze Stripe.' });
        }
    }));
    router.post('/cancel-subscription', (request, response) => __awaiter(this, void 0, void 0, function* () {
        const user = /^user:(\d+)$/.exec(ownerKey(request));
        if (user && (0, centralEntitlements_1.centralDeviceRegistered)(Number(user[1])))
            return response.status(409).json({ error: 'Subskrypcję Google Play anulujesz w Google Play. Serwer kont odświeży uprawnienia po zmianie.', managementUrl: 'https://play.google.com/store/account/subscriptions' });
        if ((0, devPlans_1.devPlan)(ownerKey(request)))
            return response.status(409).json({ error: 'W trybie testu planu wyłącz go przed zmianą płatności Stripe.' });
        const stripe = getStripe();
        if (!stripe)
            return response.status(503).json({ error: 'Płatności nie są skonfigurowane.' });
        const key = ownerKey(request);
        const localSubscription = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
        if (!(localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.providerSubscriptionId))
            return response.status(404).json({ error: 'Nie znaleziono subskrypcji.' });
        try {
            return response.json(yield (0, stripeBilling_1.cancelStripeSubscription)(prisma, stripe, key, localSubscription.providerSubscriptionId, localSubscription.plan));
        }
        catch (error) {
            if (error instanceof stripeBilling_1.BillingHttpError)
                return response.status(error.statusCode).json({ error: error.message });
            return response.status(500).json({ error: error instanceof Error ? error.message : 'Nie udało się anulować subskrypcji.' });
        }
    }));
    router.get('/history', (request, response) => __awaiter(this, void 0, void 0, function* () {
        const key = ownerKey(request);
        const user = /^user:(\d+)$/.exec(key);
        if (user && (0, centralEntitlements_1.centralDeviceRegistered)(Number(user[1]))) {
            try {
                return response.json(yield (0, centralEntitlements_1.centralPlanRequest)(Number(user[1]), '/billing/history'));
            }
            catch (_a) {
                return response.status(503).json({ error: 'Historia konta jest chwilowo niedostępna na serwerze.' });
            }
        }
        let transactions = yield prisma.billingTransaction.findMany({ where: { ownerKey: key }, orderBy: { occurredAt: 'desc' }, take: 100 });
        if (transactions.length === 0) {
            const localSubscription = yield prisma.subscription.findUnique({ where: { ownerKey: key } });
            const stripe = getStripe();
            if (stripe && (localSubscription === null || localSubscription === void 0 ? void 0 : localSubscription.providerSubscriptionId)) {
                try {
                    const subscription = yield stripe.subscriptions.retrieve(localSubscription.providerSubscriptionId, { expand: ['latest_invoice'] });
                    const invoice = typeof subscription.latest_invoice === 'object' && subscription.latest_invoice ? subscription.latest_invoice : null;
                    if (invoice && typeof invoice.id === 'string') {
                        yield (0, stripeBilling_1.recordBillingTransaction)(prisma, { ownerKey: key, providerReference: invoice.id, providerSubscriptionId: subscription.id, type: 'subscription_payment', status: invoice.status === 'paid' ? 'succeeded' : String(invoice.status || 'open'), amount: invoice.amount_paid || 0, currency: invoice.currency, description: 'Subskrypcja E‑Teczka Premium' });
                        transactions = yield prisma.billingTransaction.findMany({ where: { ownerKey: key }, orderBy: { occurredAt: 'desc' }, take: 100 });
                    }
                }
                catch (_b) { }
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
            yield prisma.subscription.updateMany({ where: { ownerKey: ownerKey(request), providerSubscriptionId: subscription.id }, data: { plan: 'premium', status: subscription.status, currentPeriodEnd: (0, stripeBilling_1.periodEnd)((_e = subscription.items.data[0]) === null || _e === void 0 ? void 0 : _e.current_period_end), cancelAtPeriodEnd: Boolean(subscription.cancel_at || subscription.cancel_at_period_end) } });
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
            if (!(yield (0, stripeBilling_1.permitsReplacement)(stripe, existing, ownerKey(request))))
                return response.status(409).json({ error: 'Masz aktywną subskrypcję bez zaplanowanego anulowania.' });
        }
        catch (_g) {
            return response.status(503).json({ error: 'Nie udało się sprawdzić anulowania w Stripe. Spróbuj ponownie.' });
        }
        if ((existing === null || existing === void 0 ? void 0 : existing.cancelAtPeriodEnd) && ['active', 'trialing'].includes(existing.status) && ((_d = request.body) === null || _d === void 0 ? void 0 : _d.acceptReplacement) !== true)
            return response.status(409).json({ error: 'Przed nową płatnością potwierdź rozpoczęcie nowego planu i opłatę za niego.' });
        const plan = ((_e = request.body) === null || _e === void 0 ? void 0 : _e.plan) === 'standard' ? 'standard' : 'premium';
        const interval = ((_f = request.body) === null || _f === void 0 ? void 0 : _f.interval) === 'yearly' ? 'yearly' : 'monthly';
        const price = plan === 'standard' ? (interval === 'yearly' ? process.env.STRIPE_STANDARD_PRICE_YEARLY : process.env.STRIPE_STANDARD_PRICE_MONTHLY) : (interval === 'yearly' ? process.env.STRIPE_PRICE_YEARLY : process.env.STRIPE_PRICE_MONTHLY);
        const testKey = (process.env.STRIPE_SECRET_KEY || '').startsWith('sk_test_');
        if (!price && !testKey)
            return response.status(503).json({ error: `Brak ceny dla planu ${interval}.` });
        const lineItem = price ? { price, quantity: 1 } : { price_data: { currency: 'pln', unit_amount: plan === 'standard' ? (interval === 'yearly' ? 4990 : 499) : (interval === 'yearly' ? 9990 : 999), recurring: { interval: interval === 'yearly' ? 'year' : 'month' }, product_data: { name: `E‑Teczka ${plan === 'standard' ? 'Standard' : 'Premium'}` } }, quantity: 1 };
        const returnBase = (0, billingReturnUrl_1.billingReturnBase)(request.socket.localAddress);
        const replacesSubscriptionId = (existing === null || existing === void 0 ? void 0 : existing.cancelAtPeriodEnd) && ['active', 'trialing'].includes(existing.status) ? existing.providerSubscriptionId || '' : '';
        const checkoutParams = { mode: 'subscription', line_items: [lineItem], success_url: process.env.ETECZKA_BILLING_SUCCESS_URL || `${returnBase}/api/billing/confirm?session_id={CHECKOUT_SESSION_ID}`, cancel_url: process.env.ETECZKA_BILLING_CANCEL_URL || `${returnBase}/api/billing/cancel`, metadata: { ownerKey: ownerKey(request), plan, replacesSubscriptionId }, subscription_data: { metadata: { ownerKey: ownerKey(request), plan } } };
        checkoutParams.managed_payments = { enabled: false };
        const session = yield stripe.checkout.sessions.create(checkoutParams);
        return response.json({ url: session.url, sessionId: session.id });
    }));
    return router;
}
function createBillingWebhookHandler(prisma, getStripe = stripeBilling_1.defaultStripeClient) {
    return (request, response) => __awaiter(this, void 0, void 0, function* () {
        const stripe = getStripe();
        const signature = request.header('stripe-signature');
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!stripe || !signature || !secret)
            return response.status(503).json({ error: 'Webhook Stripe nie jest skonfigurowany.' });
        let event;
        try {
            event = stripe.webhooks.constructEvent(request.body, signature, secret);
        }
        catch (_a) {
            return response.status(400).json({ error: 'Nieprawidłowy podpis webhooka Stripe.' });
        }
        try {
            yield (0, stripeBilling_1.processStripeWebhookEvent)(prisma, stripe, event);
            return response.json({ received: true });
        }
        catch (_b) {
            return response.status(503).json({ error: 'Nie udało się sprawdzić subskrypcji.' });
        }
    });
}
