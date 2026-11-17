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
exports.eraseLocalAccountCompletely = eraseLocalAccountCompletely;
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const paths_1 = require("../config/paths");
const backupCrypto_1 = require("./backupCrypto");
const centralAccountLink_1 = require("./centralAccountLink");
function removeFromEncryptedJson(filePath, shouldDeleteKey) {
    if (!node_fs_1.default.existsSync(filePath))
        return;
    try {
        const raw = node_fs_1.default.readFileSync(filePath, 'utf8');
        const data = JSON.parse((0, backupCrypto_1.decrypt)(raw));
        let changed = false;
        for (const key of Object.keys(data)) {
            if (shouldDeleteKey(key)) {
                delete data[key];
                changed = true;
            }
        }
        if (changed) {
            node_fs_1.default.writeFileSync(`${filePath}.tmp`, (0, backupCrypto_1.encrypt)(JSON.stringify(data)), { mode: 0o600 });
            node_fs_1.default.renameSync(`${filePath}.tmp`, filePath);
        }
    }
    catch ( /* ignore unreadable or missing encrypted stores */_a) { /* ignore unreadable or missing encrypted stores */ }
}
function safeExecute(fn) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            yield fn();
        }
        catch ( /* ignore when optional runtime table does not exist */_a) { /* ignore when optional runtime table does not exist */ }
    });
}
/**
 * Permanently erases a user account and all of its local database records,
 * uploaded files, vault secrets, and cached security artifacts.
 */
function eraseLocalAccountCompletely(prisma, userId, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const user = yield prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
        if (!user)
            throw new Error('Nie znaleziono konta użytkownika.');
        let centralDeleted = false;
        let centralNote;
        if (options === null || options === void 0 ? void 0 : options.deleteCentral) {
            const base = (0, centralAccountLink_1.centralAccountOrigin)(process.env.ETECZKA_CENTRAL_ACCOUNT_URL);
            if (base && options.centralPassword) {
                try {
                    const login = yield fetch(`${base}/login`, {
                        method: 'POST',
                        headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({ email: user.email, password: options.centralPassword }),
                        redirect: 'error',
                        signal: AbortSignal.timeout(10000),
                    });
                    if (login.ok) {
                        const session = (yield login.json());
                        if (session.token) {
                            const del = yield fetch(`${base}/delete-account`, {
                                method: 'POST',
                                headers: { authorization: `Bearer ${session.token}` },
                                redirect: 'error',
                                signal: AbortSignal.timeout(10000),
                            });
                            centralDeleted = del.ok;
                        }
                    }
                    else {
                        centralNote = 'Nie udało się potwierdzić hasła na konto.arecki.pl — konto centralne musisz usunąć ręcznie na konto.arecki.pl/account.';
                    }
                }
                catch (_a) {
                    centralNote = 'Nie udało się połączyć z konto.arecki.pl — konto centralne możesz usunąć ręcznie na konto.arecki.pl/account.';
                }
            }
            else if (base) {
                centralNote = 'Aby usunąć również globalny login z konto.arecki.pl (np. przy logowaniu Google), użyj przycisku „Usuń konto” na konto.arecki.pl/account.';
            }
        }
        const ownedFolders = yield prisma.folder.findMany({ where: { ownerId: userId }, select: { id: true } });
        const folderIds = ownedFolders.map(f => f.id);
        const docs = yield prisma.document.findMany({
            where: { OR: [{ userId }, ...(folderIds.length ? [{ folderId: { in: folderIds } }] : [])] },
            select: { id: true, filePath: true },
        });
        const docIds = docs.map(d => d.id);
        const ownerKeys = [`user:${userId}`, `dev-test:user:${userId}`];
        yield prisma.$transaction((tx) => __awaiter(this, void 0, void 0, function* () {
            if (docIds.length) {
                yield tx.documentTag.deleteMany({ where: { documentId: { in: docIds } } });
                yield tx.documentLineItem.deleteMany({ where: { documentId: { in: docIds } } });
                yield tx.document.deleteMany({ where: { id: { in: docIds } } });
            }
            if (folderIds.length) {
                yield tx.folderShare.deleteMany({ where: { folderId: { in: folderIds } } });
                yield tx.folder.deleteMany({ where: { id: { in: folderIds } } });
            }
            yield tx.folderShare.deleteMany({ where: { userId } });
            yield tx.planTagOwner.deleteMany({ where: { ownerId: userId } });
            yield tx.planUsage.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
            yield tx.planTrial.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
            yield tx.planPrinterClaim.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
            yield tx.planScanReceipt.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
            yield tx.syncOperation.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
            yield tx.subscription.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
            yield tx.backupDestination.deleteMany({ where: { ownerKey: { in: ownerKeys } } });
            yield tx.authSession.deleteMany({ where: { userId } });
            yield tx.user.delete({ where: { id: userId } });
        }));
        yield safeExecute(() => prisma.$executeRaw `DELETE FROM FamilyMember WHERE userId = ${userId}`);
        yield safeExecute(() => prisma.$executeRaw `DELETE FROM FamilyInvite WHERE createdByUserId = ${userId} OR LOWER(email) = ${user.email.trim().toLowerCase()}`);
        yield safeExecute(() => prisma.$executeRaw `DELETE FROM FamilyGroup WHERE hostUserId = ${userId}`);
        yield safeExecute(() => prisma.$executeRaw `DELETE FROM TesterConsent WHERE userId = ${userId}`);
        yield safeExecute(() => prisma.$executeRaw `DELETE FROM CentralAccountLink WHERE localUserId = ${userId}`);
        for (const file of new Set(docs.map(d => d.filePath))) {
            if (!file || node_path_1.default.basename(file) !== file)
                continue;
            const stillUsed = yield prisma.document.count({ where: { filePath: file } });
            if (stillUsed > 0)
                continue;
            try {
                yield node_fs_1.default.promises.unlink(node_path_1.default.join(paths_1.uploadsDir, file));
            }
            catch ( /* ignore missing files */_b) { /* ignore missing files */ }
        }
        const workspaceFile = node_path_1.default.join(paths_1.securityDir, `archive-workspace-${userId}.json`);
        try {
            if (node_fs_1.default.existsSync(workspaceFile))
                node_fs_1.default.unlinkSync(workspaceFile);
        }
        catch ( /* ignore */_c) { /* ignore */ }
        for (const encFile of ['folder-vaults.enc', 'folder-vault.enc']) {
            removeFromEncryptedJson(node_path_1.default.join(paths_1.securityDir, encFile), key => key.startsWith(`${userId}:`));
        }
        for (const encFile of ['central-entitlements.enc', 'central-plan-snapshots.enc', 'central-plan-journal.enc', 'backup-mfa.enc', 'account-login-mfa.enc', 'hello-credentials.enc']) {
            removeFromEncryptedJson(node_path_1.default.join(paths_1.securityDir, encFile), key => key === String(userId) || key === `user:${userId}`);
        }
        return { centralDeleted, centralNote };
    });
}
