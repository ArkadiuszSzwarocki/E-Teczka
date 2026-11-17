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
exports.centralOwner = centralOwner;
exports.requireCentralPlanOwner = requireCentralPlanOwner;
exports.markCentralInventoryDirty = markCentralInventoryDirty;
exports.reserveCentralPlan = reserveCentralPlan;
exports.centralResourceOperation = centralResourceOperation;
exports.recoverCentralPlanJournal = recoverCentralPlanJournal;
exports.requireSynchronizedCentralPlan = requireSynchronizedCentralPlan;
exports.instrumentPlanTransactions = instrumentPlanTransactions;
exports.bootstrapCentralPlan = bootstrapCentralPlan;
exports.centralOfflineStatus = centralOfflineStatus;
exports.prepareCentralOffline = prepareCentralOffline;
const node_async_hooks_1 = require("node:async_hooks");
const node_crypto_1 = __importDefault(require("node:crypto"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const centralEntitlements_1 = require("./centralEntitlements");
const devPlans_1 = require("./devPlans");
const centralAccountLink_1 = require("./centralAccountLink");
const context = new node_async_hooks_1.AsyncLocalStorage(), active = new Set();
const filename = () => node_path_1.default.join(process.cwd(), 'security', 'central-plan-journal.enc');
function read() { try {
    const text = node_fs_1.default.readFileSync(filename(), 'utf8');
    return JSON.parse(require('./backupCrypto').decrypt(text));
}
catch (error) {
    if (error.code === 'ENOENT')
        return { entries: {}, migrated: {} };
    throw error;
} }
function save(data) { const file = filename(); node_fs_1.default.mkdirSync(node_path_1.default.dirname(file), { recursive: true }); node_fs_1.default.writeFileSync(file + '.tmp', require('./backupCrypto').encrypt(JSON.stringify(data)), { mode: 0o600 }); node_fs_1.default.renameSync(file + '.tmp', file); }
const key = (op) => `${op.userId}:${op.operationId}`;
function centralOwner(ownerKey) { if ((0, devPlans_1.devPlan)(ownerKey) !== undefined)
    return null; const match = /^user:(\d+)$/.exec(ownerKey); const id = match ? Number(match[1]) : null; return id && (0, centralEntitlements_1.centralDeviceRegistered)(id) ? id : null; }
function requireCentralPlanOwner(ownerKey) { const user = centralOwner(ownerKey); if (!user && (0, devPlans_1.devPlan)(ownerKey) === undefined && (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL))
    throw new Error('Zaloguj się na konto E‑Teczki, aby pobrać wspólne limity z serwera.'); return user; }
function markCentralInventoryDirty() { const ctx = context.getStore(); if (ctx)
    ctx.dirty = true; }
function reserveCentralPlan(tx, userId, feature, operationId, amount) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const ctx = context.getStore();
        if (!ctx)
            throw new Error('Operacja planu wymaga bezpiecznej transakcji.');
        if (!ctx.synchronized.has(userId)) {
            try {
                const inv = yield inventory(ctx.prisma, userId);
                yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/settle', { action: 'commit', operations: [], inventory: inv });
            }
            catch (error) {
                if (!(0, centralEntitlements_1.isCentralUnavailable)(error))
                    throw error;
            }
            ctx.synchronized.add(userId);
        }
        const id = node_crypto_1.default.createHash('sha256').update(`${feature}:${operationId}`).digest('hex');
        const op = { userId, operationId: id, transactionId: ctx.transactionId };
        yield tx.$executeRaw `INSERT OR IGNORE INTO CentralPlanCommit(operationId) VALUES (${key(op)})`;
        if (ctx.operations.some(existing => key(existing) === key(op)))
            return;
        const journal = read(), prior = journal.entries[key(op)];
        if (prior)
            throw new Error('Ta operacja oczekuje na rozliczenie. Połącz się z internetem i zaczekaj na synchronizację przed ponowieniem.');
        let pool;
        try {
            const lease = (0, centralEntitlements_1.centralOfflineLease)(userId);
            if (Date.now() >= (journal.clock || 0) - 60000)
                pool = (_b = (_a = journal.pools) === null || _a === void 0 ? void 0 : _a[userId]) === null || _b === void 0 ? void 0 : _b.find(p => p.plan === lease.plan && p.accountId === lease.accountId && p.deviceId === lease.deviceId && !p.closed && p.feature === feature && p.expiresAt > Date.now() && p.remaining >= amount);
        }
        catch ( /* An expired or revoked lease cannot spend a pool. */_c) { /* An expired or revoked lease cannot spend a pool. */ }
        if (pool) {
            pool.remaining -= amount;
            Object.assign(op, { poolId: pool.poolId, feature, amount });
        }
        journal.clock = Math.max(journal.clock || 0, Date.now());
        journal.entries[key(op)] = op;
        save(journal);
        ctx.operations.push(op);
        if (['documents', 'tags'].includes(feature))
            ctx.dirty = true;
        if (!pool) {
            try {
                yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/reserve', { feature, operationId: id, amount });
            }
            catch (error) {
                if ((0, centralEntitlements_1.isCentralUnavailable)(error))
                    throw new Error('Pula offline jest wyczerpana lub wygasła. Połącz się z internetem, aby pobrać kolejny przydział.');
                throw error;
            }
        }
    });
}
function centralResourceOperation() { const ctx = context.getStore(); if (!ctx)
    throw new Error('Brak transakcji limitu.'); return `${ctx.transactionId}:${ctx.operations.length}`; }
function inventory(prisma, userId) {
    return __awaiter(this, void 0, void 0, function* () {
        const status = yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/status');
        const [documents, tables] = yield Promise.all([prisma.document.count({ where: { folder: { ownerId: userId } } }), prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name='PlanTagOwner'")]);
        const tags = tables.length ? yield prisma.$queryRawUnsafe('SELECT COUNT(*) AS count FROM PlanTagOwner WHERE ownerId=?', userId) : [{ count: 0 }];
        return { documents, tags: Number(tags[0].count), revision: Math.max(Date.now(), Number(status.inventoryRevision || 0) + 1) };
    });
}
let queue = Promise.resolve();
function serial(fn) { const task = queue.then(fn, fn); queue = task.catch(() => undefined); return task; }
function settle(prisma, ops, commit, dirty) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c;
        const users = new Set(ops.map(op => op.userId));
        if (dirty)
            (0, centralEntitlements_1.centralDeviceUsers)().forEach(id => users.add(id));
        for (const userId of users) {
            const own = ops.filter(op => op.userId === userId);
            try {
                const inv = commit && (dirty || own.length) ? yield inventory(prisma, userId) : undefined;
                yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/settle', Object.assign({ action: commit ? 'commit' : 'cancel', operations: own.map(op => op.operationId), pooled: own.filter(op => op.poolId).map(op => ({ operationId: op.operationId, poolId: op.poolId, feature: op.feature, amount: op.amount })) }, (inv ? { inventory: inv } : {})));
                const journal = read();
                for (const op of own) {
                    if (!commit && ((_a = journal.entries[key(op)]) === null || _a === void 0 ? void 0 : _a.poolId)) {
                        const pool = (_c = (_b = journal.pools) === null || _b === void 0 ? void 0 : _b[userId]) === null || _c === void 0 ? void 0 : _c.find(p => p.poolId === op.poolId);
                        if (pool)
                            pool.remaining += op.amount;
                    }
                    delete journal.entries[key(op)];
                }
                save(journal);
            }
            catch ( /* Durable markers and journal retain every unacknowledged operation. */_d) { /* Durable markers and journal retain every unacknowledged operation. */ }
        }
    });
}
function recoverCentralPlanJournal(prisma) {
    return __awaiter(this, void 0, void 0, function* () { return serial(() => __awaiter(this, void 0, void 0, function* () { const ops = Object.values(read().entries).filter(op => !active.has(op.transactionId)); for (const op of ops) {
        const rows = yield prisma.$queryRaw `SELECT operationId FROM CentralPlanCommit WHERE operationId=${key(op)}`;
        yield settle(prisma, [op], rows.length > 0, rows.length > 0);
    } yield settle(prisma, [], true, true); })); });
}
function requireSynchronizedCentralPlan(prisma, ownerKey) {
    return __awaiter(this, void 0, void 0, function* () { const user = centralOwner(ownerKey); if (!user)
        return; yield recoverCentralPlanJournal(prisma); if (Object.values(read().entries).some(op => op.userId === user))
        throw new Error('Połącz się z internetem i zaczekaj na uzgodnienie liczników przed odtworzeniem kopii.'); const state = yield (0, centralEntitlements_1.centralPlanRequest)(user, '/ledger/status'); if (state.offline)
        throw new Error('Odtwarzanie kopii wymaga połączenia z serwerem kont.'); });
}
function instrumentPlanTransactions(prisma) {
    const original = prisma.$transaction.bind(prisma);
    const ready = prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS CentralPlanCommit (operationId TEXT PRIMARY KEY)');
    const client = prisma;
    if (client.__centralPlanTransactions)
        return;
    client.__centralPlanTransactions = true;
    const track = (tx, ctx) => new Proxy(tx, { get(target, property) { const value = target[property]; if (['document', 'tag', 'folder'].includes(String(property)))
            return new Proxy(value, { get(model, method) { const fn = model[method]; if (typeof fn !== 'function')
                    return fn; return (...args) => { if (!String(method).startsWith('find') && !['count', 'aggregate', 'groupBy'].includes(String(method)))
                    ctx.dirty = true; return fn.apply(model, args); }; } }); if (typeof value === 'function')
            return (...args) => { if (String(property).startsWith('$executeRaw') && String(args[0]).includes('PlanTagOwner'))
                ctx.dirty = true; return value.apply(target, args); }; return value; } });
    client.$transaction = (input, options) => __awaiter(this, void 0, void 0, function* () { if (typeof input !== 'function')
        return original(input, options); yield ready; const ctx = { transactionId: node_crypto_1.default.randomUUID(), operations: [], dirty: false, prisma, synchronized: new Set() }; active.add(ctx.transactionId); try {
        const result = yield original((tx) => context.run(ctx, () => input(track(tx, ctx))), Object.assign({ maxWait: 10000, timeout: 30000 }, options));
        yield serial(() => settle(prisma, ctx.operations, true, ctx.dirty));
        return result;
    }
    catch (error) {
        yield serial(() => settle(prisma, ctx.operations, false, false));
        throw error;
    }
    finally {
        active.delete(ctx.transactionId);
    } });
    void ready.then(() => recoverCentralPlanJournal(prisma)).catch(error => console.error('[plans] Nie udało się uzgodnić liczników:', error.message));
    const timer = setInterval(() => { void (() => __awaiter(this, void 0, void 0, function* () { yield recoverCentralPlanJournal(prisma); for (const userId of (0, centralEntitlements_1.centralDeviceUsers)()) {
        const state = centralOfflineStatus(userId);
        if (!state.pending && !state.pools.some(p => p.available > 0)) {
            yield (0, centralEntitlements_1.centralEntitlement)(userId, true);
            yield prepareCentralOffline(prisma, userId);
        }
    } }))().catch(() => undefined); }, 60000);
    timer.unref();
}
function bootstrapCentralPlan(prisma_1, userId_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, userId, prepareOffline = true) {
        yield prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS CentralPlanCommit (operationId TEXT PRIMARY KEY)');
        const journal = read();
        if (!journal.migrated[String(userId)]) {
            const tables = yield prisma.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('PlanTrial','PlanUsage')");
            const trials = tables.some(t => t.name === 'PlanTrial') ? yield prisma.$queryRawUnsafe('SELECT feature,startedAt FROM PlanTrial WHERE ownerKey=?', `user:${userId}`) : [];
            const usage = tables.some(t => t.name === 'PlanUsage') ? yield prisma.$queryRawUnsafe('SELECT feature,operationId,amount,usedAt FROM PlanUsage WHERE ownerKey=?', `user:${userId}`) : [];
            const normalized = usage.map(u => (Object.assign(Object.assign({}, u), { amount: Number(u.amount), usedAt: Number(u.usedAt) })));
            for (let offset = 0; offset < Math.max(1, normalized.length); offset += 500) {
                const body = { trials: trials.map(t => (Object.assign(Object.assign({}, t), { startedAt: Number(t.startedAt) }))), usage: normalized.slice(offset, offset + 500) };
                const batchId = node_crypto_1.default.createHash('sha256').update(JSON.stringify(body)).digest('hex');
                yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/migrate', Object.assign({ batchId }, body));
            }
            const current = read();
            current.migrated[String(userId)] = true;
            save(current);
        }
        yield serial(() => __awaiter(this, void 0, void 0, function* () { const inv = yield inventory(prisma, userId); yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/settle', { action: 'commit', operations: [], inventory: inv }); }));
        if (prepareOffline)
            try {
                yield prepareCentralOffline(prisma, userId);
            }
            catch (error) {
                console.warn('[plans] Przydział offline będzie ponowiony po połączeniu z serwerem.');
            }
    });
}
function centralOfflineStatus(userId) { var _a; const journal = read(); let lease; let valid = false; try {
    lease = (0, centralEntitlements_1.centralOfflineLease)(userId);
    valid = Date.now() >= (journal.clock || 0) - 60000;
}
catch (_b) { } return { pools: (((_a = journal.pools) === null || _a === void 0 ? void 0 : _a[userId]) || []).filter(p => !p.closed).map(p => (Object.assign(Object.assign({}, p), { available: valid && p.plan === (lease === null || lease === void 0 ? void 0 : lease.plan) && p.accountId === (lease === null || lease === void 0 ? void 0 : lease.accountId) && p.deviceId === (lease === null || lease === void 0 ? void 0 : lease.deviceId) && p.expiresAt > Date.now() ? p.remaining : 0 }))), pending: Object.values(journal.entries).filter(op => op.userId === userId).length }; }
function prepareCentralOffline(prisma_1, userId_1) {
    return __awaiter(this, arguments, void 0, function* (prisma, userId, budgets = { documents: 5, tags: 1, cameraScan: 5, printerScan: 5, merge: 2 }) {
        yield recoverCentralPlanJournal(prisma);
        return serial(() => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            var _d;
            if (active.size || Object.values(read().entries).some(op => op.userId === userId))
                throw new Error('Zaczekaj na zakończenie i synchronizację operacji przed pobraniem puli offline.');
            const status = yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/status');
            if (status.offline)
                throw new Error('Przygotowanie do pracy offline wymaga połączenia z internetem.');
            const lease = (0, centralEntitlements_1.centralOfflineLease)(userId);
            for (const value of Object.values(budgets))
                if (!Number.isSafeInteger(value) || value < 0 || value > 100000)
                    throw new Error('Nieprawidłowy rozmiar puli offline.');
            for (const feature of ['documents', 'tags', 'cameraScan', 'printerScan', 'merge']) {
                const amount = (_a = budgets[feature]) !== null && _a !== void 0 ? _a : 0;
                if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100000)
                    throw new Error('Nieprawidłowy rozmiar puli offline.');
                // Disable locally before releasing remotely. A lost response cannot resurrect spendable quota.
                let journal = read();
                (_b = journal.pools) !== null && _b !== void 0 ? _b : (journal.pools = {});
                const pools = (_c = (_d = journal.pools)[userId]) !== null && _c !== void 0 ? _c : (_d[userId] = []);
                for (const pool of pools.filter(p => p.feature === feature))
                    pool.closed = true;
                save(journal);
                for (const pool of pools.filter(p => p.feature === feature))
                    yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/offline', { poolId: pool.poolId, close: true });
                journal = read();
                journal.pools[userId] = journal.pools[userId].filter(p => p.feature !== feature);
                save(journal);
                if (!amount)
                    continue;
                const poolId = node_crypto_1.default.randomBytes(32).toString('hex');
                // Persist an inactive claim first, so an allocation whose response is lost remains releasable.
                journal = read();
                journal.pools[userId].push({ poolId, feature, remaining: 0, expiresAt: 0, closed: true });
                save(journal);
                const grant = yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/offline', { poolId, feature, amount });
                journal = read();
                journal.pools[userId] = journal.pools[userId].map(p => p.poolId === poolId ? Object.assign(Object.assign({}, grant), { accountId: lease.accountId, deviceId: lease.deviceId, plan: lease.plan }) : p);
                journal.clock = Math.max(journal.clock || 0, Date.now());
                save(journal);
            }
            yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/status');
            for (const feature of ['ocr', 'cloudBackup'])
                yield (0, centralEntitlements_1.centralPlanRequest)(userId, '/ledger/trial', { feature, start: false });
            return centralOfflineStatus(userId);
        }));
    });
}
