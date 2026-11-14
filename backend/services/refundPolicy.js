"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculateUnusedMonthsRefund = calculateUnusedMonthsRefund;
exports.paidAccessEndsAt = paidAccessEndsAt;
function addMonths(start, months) {
    const first = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 1, start.getUTCHours(), start.getUTCMinutes(), start.getUTCSeconds(), start.getUTCMilliseconds()));
    const daysInMonth = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
    first.setUTCDate(Math.min(start.getUTCDate(), daysInMonth));
    return first;
}
/** Started billing months are consumed; only future complete months are refunded. */
function calculateUnusedMonthsRefund(details, now) {
    const { periodStart, periodEnd, amountPaid } = details;
    if (!periodStart || !periodEnd || !Number.isFinite(periodStart.getTime()) || !Number.isFinite(periodEnd.getTime()) || !Number.isFinite(now.getTime()) || periodEnd <= periodStart || amountPaid <= 0)
        return { billedMonths: 0, refundedMonths: 0, refundAmount: 0 };
    let billedMonths = 0;
    let refundedMonths = 0;
    while (billedMonths < 120 && addMonths(periodStart, billedMonths) < periodEnd) {
        if (billedMonths > 0 && addMonths(periodStart, billedMonths) > now)
            refundedMonths++;
        billedMonths++;
    }
    if (billedMonths === 120 && addMonths(periodStart, billedMonths) < periodEnd)
        throw new Error('Okres subskrypcji przekracza dopuszczalny zakres.');
    return { billedMonths, refundedMonths, refundAmount: Math.min(amountPaid, Math.round(amountPaid * refundedMonths / billedMonths)) };
}
/** The already-started month stays available after cancellation. */
function paidAccessEndsAt(details, now) {
    const { periodStart, periodEnd } = details;
    if (!periodStart || !periodEnd || periodEnd <= periodStart || now >= periodEnd)
        return null;
    for (let month = 1; month <= 120; month++) {
        const boundary = addMonths(periodStart, month);
        if (boundary > now)
            return boundary < periodEnd ? boundary : periodEnd;
    }
    return null;
}
