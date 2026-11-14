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
Object.defineProperty(exports, "__esModule", { value: true });
exports.latestScheduledTime = latestScheduledTime;
exports.backupDue = backupDue;
exports.createBackupScheduler = createBackupScheduler;
const errors_1 = require("../utils/errors");
const planLedger_1 = require("./planLedger");
const devPlans_1 = require("./devPlans");
/** Most recent scheduled time, using the server's local timezone. */
function latestScheduledTime(schedule, now) {
    const match = /^(daily|weekly)(?:@([01]\d|2[0-3]):([0-5]\d))?$/.exec(schedule || '');
    if (!match)
        return null;
    const due = new Date(now);
    due.setHours(match[2] === undefined ? 2 : Number(match[2]), match[3] === undefined ? 15 : Number(match[3]), 0, 0);
    if (match[1] === 'weekly') {
        const daysSinceMonday = (due.getDay() + 6) % 7;
        due.setDate(due.getDate() - daysSinceMonday);
        if (due > now)
            due.setDate(due.getDate() - 7);
    }
    else if (due > now)
        due.setDate(due.getDate() - 1);
    return due;
}
function backupDue(destination, now) {
    const due = latestScheduledTime(destination.schedule, now);
    if (!due || due < destination.createdAt)
        return false;
    if (!destination.lastBackupAt || destination.lastBackupAt < due)
        return true;
    return destination.lastBackupStatus === 'failed' && now.getTime() - destination.lastBackupAt.getTime() >= 60 * 60 * 1000;
}
function createBackupScheduler(prisma, runBackup) {
    let running = false;
    return function checkScheduledBackups() {
        return __awaiter(this, arguments, void 0, function* (now = new Date()) {
            if (running)
                return;
            running = true;
            try {
                const destinations = yield prisma.backupDestination.findMany({ where: { enabled: true } });
                for (const destination of destinations) {
                    // A simulated subscription must never trigger a real scheduled upload.
                    if ((0, devPlans_1.devPlan)(destination.ownerKey) !== undefined)
                        continue;
                    if (!backupDue(destination, now))
                        continue;
                    if (!(yield (0, planLedger_1.featureTrial)(prisma, destination.ownerKey, 'cloudBackup', false, now)).allowed)
                        continue;
                    const ownerId = destination.ownerKey.startsWith('user:') ? Number(destination.ownerKey.slice(5)) : 1;
                    const run = yield prisma.backupRun.create({ data: { destinationId: destination.id, status: 'running' } });
                    try {
                        if (!(yield runBackup(prisma, destination.ownerKey, Number.isFinite(ownerId) && ownerId > 0 ? ownerId : 1)))
                            throw new Error('Harmonogram kopii został wyłączony.');
                        const finishedAt = new Date();
                        yield prisma.backupRun.update({ where: { id: run.id }, data: { status: 'success', finishedAt } });
                        yield prisma.backupDestination.update({ where: { id: destination.id }, data: { lastBackupAt: finishedAt, lastBackupStatus: 'success', lastBackupError: null } });
                    }
                    catch (error) {
                        const details = (0, errors_1.errorMessage)(error).slice(0, 1000);
                        const finishedAt = new Date();
                        yield prisma.backupRun.update({ where: { id: run.id }, data: { status: 'failed', error: details, finishedAt } });
                        yield prisma.backupDestination.update({ where: { id: destination.id }, data: { lastBackupAt: finishedAt, lastBackupStatus: 'failed', lastBackupError: details } });
                        console.error(`[backup] Scheduled backup failed for ${destination.ownerKey}:`, details);
                    }
                }
            }
            finally {
                running = false;
            }
        });
    };
}
