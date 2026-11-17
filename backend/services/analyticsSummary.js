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
exports.buildAnalyticsSummary = buildAnalyticsSummary;
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../config/paths");
const folderVault_1 = require("./folderVault");
const ocrText_1 = require("./ocrText");
const receiptOcrParser_1 = require("./receiptOcrParser");
const familyAccess_1 = require("./familyAccess");
const MONTH_LABELS_PL = ['STY', 'LUT', 'MAR', 'KWI', 'MAJ', 'CZE', 'LIP', 'SIE', 'WRZ', 'PAŹ', 'LIS', 'GRU'];
function computeRetentionExpiry(createdAt, value, unit) {
    const expiry = new Date(createdAt);
    if (unit === 'years')
        expiry.setFullYear(expiry.getFullYear() + value);
    else if (unit === 'months')
        expiry.setMonth(expiry.getMonth() + value);
    else if (unit === 'days')
        expiry.setDate(expiry.getDate() + value);
    else if (unit === 'minutes')
        expiry.setMinutes(expiry.getMinutes() + value);
    else
        return null;
    return expiry;
}
/** Computes real financial, storage, security, and deadline analytics for the dashboard. */
function buildAnalyticsSummary(prisma, ownerId, selectedMonth) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        const now = new Date();
        const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
        const targetMonth = selectedMonth && /^\d{4}-\d{2}$/.test(selectedMonth) ? selectedMonth : currentMonthKey;
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        const sixMonthsStart = new Date(now.getFullYear(), now.getMonth() - 5, 1);
        const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
        const vaultStore = (0, folderVault_1.createFolderVaultStore)(node_path_1.default.join(paths_1.securityDir, 'folder-vaults.enc'));
        const accessibleIds = yield (0, familyAccess_1.getAccessibleFolderIds)(prisma, ownerId);
        const [folders, rawDocuments] = yield Promise.all([
            prisma.folder.findMany({ where: { id: { in: accessibleIds } }, select: { id: true, name: true, parentId: true } }),
            prisma.document.findMany({
                where: { folderId: { in: accessibleIds }, isDeleted: false },
                select: {
                    id: true, title: true, folderId: true, mimeType: true, createdAt: true,
                    retentionEnabled: true, retentionValue: true, retentionUnit: true, ocrText: true,
                    merchantName: true, amountCents: true, currency: true, dueDate: true, paymentStatus: true, isArchived: true,
                    lineItems: { select: { id: true, name: true, quantity: true, totalCents: true, category: true } },
                },
                orderBy: { createdAt: 'desc' },
            }),
        ]);
        // Backfill existing OCR-processed receipts that were uploaded before line-item parsing was added.
        const documents = yield Promise.all(rawDocuments.map((doc) => __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!doc.ocrText || doc.lineItems.length > 0)
                return doc;
            try {
                const parsed = (0, receiptOcrParser_1.parseReceiptFromOcr)((0, ocrText_1.readOcrText)(doc.ocrText));
                if (!parsed.isReceipt)
                    return doc;
                yield prisma.document.update({
                    where: { id: doc.id },
                    data: Object.assign(Object.assign(Object.assign({}, (parsed.merchantName && !doc.merchantName ? { merchantName: parsed.merchantName } : {})), (doc.amountCents === null && parsed.amountCents !== null ? { amountCents: parsed.amountCents } : {})), (parsed.paymentStatus && !doc.paymentStatus ? { paymentStatus: parsed.paymentStatus } : {})),
                });
                if (parsed.items.length > 0) {
                    yield prisma.documentLineItem.createMany({
                        data: parsed.items.map(item => ({
                            documentId: doc.id,
                            name: item.name,
                            quantity: item.quantity,
                            totalCents: item.totalCents,
                            category: item.category,
                        })),
                    });
                }
                const refreshedItems = parsed.items.length > 0
                    ? yield prisma.documentLineItem.findMany({ where: { documentId: doc.id }, select: { id: true, name: true, quantity: true, totalCents: true, category: true } })
                    : doc.lineItems;
                return Object.assign(Object.assign({}, doc), { merchantName: doc.merchantName || parsed.merchantName, amountCents: (_a = doc.amountCents) !== null && _a !== void 0 ? _a : parsed.amountCents, paymentStatus: doc.paymentStatus || parsed.paymentStatus, lineItems: refreshedItems });
            }
            catch (_b) {
                return doc;
            }
        })));
        const folderMap = new Map(folders.map(f => [f.id, f]));
        const rootFolderOf = (folderId) => {
            let current = folderMap.get(folderId);
            let guard = 0;
            while (current && current.parentId !== null && guard < 20) {
                current = folderMap.get(current.parentId);
                guard++;
            }
            return current ? { id: current.id, name: current.name } : null;
        };
        const vaultFolderIds = new Set(folders.filter(f => vaultStore.status(`${ownerId}:${f.id}`).configured).map(f => f.id));
        let totalCents = 0;
        let paidCents = 0;
        let unpaidCents = 0;
        const monthlyTotals = new Map();
        for (let offset = 5; offset >= 0; offset--) {
            const d = new Date(now.getFullYear(), now.getMonth() - offset, 1);
            monthlyTotals.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, 0);
        }
        let last30DaysCount = 0;
        let vaultCount = 0;
        const categoryCounts = new Map();
        const upcomingDeadlines = [];
        for (const doc of documents) {
            if (doc.createdAt >= thirtyDaysAgo)
                last30DaysCount++;
            if (vaultFolderIds.has(doc.folderId))
                vaultCount++;
            const root = rootFolderOf(doc.folderId);
            if (root) {
                const entry = categoryCounts.get(root.name) || { folderId: root.id, name: root.name, count: 0 };
                entry.count++;
                categoryCounts.set(root.name, entry);
            }
            if (typeof doc.amountCents === 'number' && doc.amountCents > 0) {
                const refDate = doc.dueDate || doc.createdAt;
                if (refDate >= monthStart) {
                    totalCents += doc.amountCents;
                    if (doc.paymentStatus === 'paid')
                        paidCents += doc.amountCents;
                    else
                        unpaidCents += doc.amountCents;
                }
                if (refDate >= sixMonthsStart) {
                    const key = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}`;
                    if (monthlyTotals.has(key))
                        monthlyTotals.set(key, (monthlyTotals.get(key) || 0) + doc.amountCents);
                }
            }
            if (!doc.isArchived) {
                if (doc.dueDate && doc.paymentStatus !== 'paid') {
                    const daysLeft = Math.ceil((doc.dueDate.getTime() - now.getTime()) / 86400000);
                    if (daysLeft >= -30 && daysLeft <= 90) {
                        upcomingDeadlines.push({
                            id: doc.id,
                            title: doc.title,
                            date: doc.dueDate.toISOString(),
                            daysLeft,
                            amountCents: doc.amountCents,
                            currency: doc.currency || 'PLN',
                            paymentStatus: doc.paymentStatus,
                            kind: 'payment',
                        });
                    }
                }
                else if (doc.retentionEnabled) {
                    const expiry = computeRetentionExpiry(doc.createdAt, doc.retentionValue, doc.retentionUnit);
                    if (expiry) {
                        const daysLeft = Math.ceil((expiry.getTime() - now.getTime()) / 86400000);
                        if (daysLeft >= 0 && daysLeft <= 45) {
                            upcomingDeadlines.push({
                                id: doc.id,
                                title: doc.title,
                                date: expiry.toISOString(),
                                daysLeft,
                                amountCents: doc.amountCents,
                                currency: doc.currency || 'PLN',
                                paymentStatus: doc.paymentStatus,
                                kind: 'retention',
                            });
                        }
                    }
                }
            }
        }
        upcomingDeadlines.sort((a, b) => a.daysLeft - b.daysLeft);
        const monthlyExpenses = Array.from(monthlyTotals.entries()).map(([key, cents]) => {
            const [, monthStr] = key.split('-');
            return { monthKey: key, label: MONTH_LABELS_PL[Number(monthStr) - 1] || key, totalCents: cents };
        });
        const activeTotal = documents.length || 1;
        const sortedCategories = Array.from(categoryCounts.values()).sort((a, b) => b.count - a.count);
        const topFour = sortedCategories.slice(0, 4).map(c => (Object.assign(Object.assign({}, c), { percent: Math.round((c.count / activeTotal) * 100) })));
        const restCount = sortedCategories.slice(4).reduce((sum, c) => sum + c.count, 0);
        if (restCount > 0)
            topFour.push({ folderId: 0, name: 'Inne', count: restCount, percent: Math.round((restCount / activeTotal) * 100) });
        const merchantMap = new Map();
        const itemCategoryMap = new Map();
        const receiptItems = [];
        for (const doc of documents) {
            const refDate = doc.dueDate || doc.createdAt;
            const docMonth = `${refDate.getFullYear()}-${String(refDate.getMonth() + 1).padStart(2, '0')}`;
            if (docMonth !== targetMonth)
                continue;
            if (!doc.merchantName && doc.lineItems.length === 0 && !(typeof doc.amountCents === 'number' && doc.amountCents > 0))
                continue;
            const docTotal = (_a = doc.amountCents) !== null && _a !== void 0 ? _a : doc.lineItems.reduce((sum, i) => sum + i.totalCents, 0);
            if (docTotal <= 0 && doc.lineItems.length === 0)
                continue;
            const store = doc.merchantName || 'Inny sklep / rachunek';
            const mEntry = merchantMap.get(store) || { name: store, totalCents: 0, receiptCount: 0, itemCount: 0 };
            mEntry.totalCents += docTotal;
            mEntry.receiptCount++;
            mEntry.itemCount += doc.lineItems.length || 1;
            merchantMap.set(store, mEntry);
            if (doc.lineItems.length === 0 && docTotal > 0) {
                const cat = 'Rachunki i inne';
                const cEntry = itemCategoryMap.get(cat) || { category: cat, totalCents: 0, itemCount: 0 };
                cEntry.totalCents += docTotal;
                cEntry.itemCount++;
                itemCategoryMap.set(cat, cEntry);
                receiptItems.push({
                    id: -doc.id,
                    documentId: doc.id,
                    documentTitle: doc.title,
                    merchantName: store,
                    name: doc.title,
                    quantity: 1,
                    totalCents: docTotal,
                    category: cat,
                    date: refDate.toISOString(),
                });
            }
            for (const item of doc.lineItems) {
                const cEntry = itemCategoryMap.get(item.category) || { category: item.category, totalCents: 0, itemCount: 0 };
                cEntry.totalCents += item.totalCents;
                cEntry.itemCount++;
                itemCategoryMap.set(item.category, cEntry);
                receiptItems.push({
                    id: item.id,
                    documentId: doc.id,
                    documentTitle: doc.title,
                    merchantName: store,
                    name: item.name,
                    quantity: item.quantity,
                    totalCents: item.totalCents,
                    category: item.category,
                    date: doc.createdAt.toISOString(),
                });
            }
        }
        return {
            selectedMonth: targetMonth,
            costsThisMonth: { totalCents, paidCents, unpaidCents, currency: 'PLN' },
            monthlyExpenses,
            documentStats: { last30DaysCount, totalCount: documents.length },
            vaultCount,
            structure: topFour,
            upcomingDeadlines: upcomingDeadlines.slice(0, 8),
            recentDocuments: documents.slice(0, 6).map(d => ({
                id: d.id,
                title: d.title,
                createdAt: d.createdAt.toISOString(),
                mimeType: d.mimeType,
                folderId: d.folderId,
                amountCents: d.amountCents,
                currency: d.currency,
            })),
            receiptMerchants: Array.from(merchantMap.values()).sort((a, b) => b.totalCents - a.totalCents),
            receiptCategories: Array.from(itemCategoryMap.values()).sort((a, b) => b.totalCents - a.totalCents),
            receiptItems: receiptItems.slice(0, 150),
        };
    });
}
