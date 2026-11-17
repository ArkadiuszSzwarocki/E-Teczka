"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractFinanceFromOcr = extractFinanceFromOcr;
const AMOUNT_LINE_PATTERNS = [
    /(?:razem\s+do\s+zap[łl]aty|do\s+zap[łl]aty|kwota\s+do\s+zap[łl]aty|suma\s+brutto|warto[śs][ćc]\s+brutto|razem|suma|total|amount\s+due)\s*[:\-]?\s*(\d{1,3}(?:[\s\u00A0]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))\s*(pln|z[łl]|eur|usd)?/gi,
    /(\d{1,3}(?:[\s\u00A0]\d{3})*(?:[.,]\d{2})|\d+(?:[.,]\d{2}))\s*(pln|z[łl])\b/gi,
];
const DUE_DATE_PATTERNS = [
    /(?:termin\s+p[łl]atno[śs]ci|p[łl]atne\s+do|termin\s+zap[łl]aty|data\s+wa[żz]no[śs]ci|wa[żz]ne\s+do|due\s+date)\s*[:\-]?\s*(\d{4}[.\-/]\d{2}[.\-/]\d{2}|\d{2}[.\-/]\d{2}[.\-/]\d{4})/i,
];
function parseAmountToCents(raw) {
    const normalized = raw.replace(/[\s\u00A0]/g, '').replace(',', '.');
    const value = Number.parseFloat(normalized);
    if (!Number.isFinite(value) || value <= 0 || value > 10000000)
        return null;
    return Math.round(value * 100);
}
function parseDateToken(token) {
    const isoMatch = token.match(/^(\d{4})[.\-/](\d{2})[.\-/](\d{2})$/);
    if (isoMatch) {
        const parsed = new Date(`${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}T12:00:00.000Z`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    const plMatch = token.match(/^(\d{2})[.\-/](\d{2})[.\-/](\d{4})$/);
    if (plMatch) {
        const parsed = new Date(`${plMatch[3]}-${plMatch[2]}-${plMatch[1]}T12:00:00.000Z`);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
    return null;
}
/** Extracts invoice/receipt total amount and payment/validity due date from OCR text. */
function extractFinanceFromOcr(text) {
    if (!text || typeof text !== 'string')
        return { amountCents: null, currency: 'PLN', dueDate: null };
    let amountCents = null;
    let currency = 'PLN';
    for (const pattern of AMOUNT_LINE_PATTERNS) {
        pattern.lastIndex = 0;
        let match;
        while ((match = pattern.exec(text)) !== null) {
            const cents = parseAmountToCents(match[1]);
            if (cents !== null) {
                amountCents = cents;
                const unit = (match[2] || '').toUpperCase();
                if (unit === 'EUR' || unit === 'USD')
                    currency = unit;
                else
                    currency = 'PLN';
            }
        }
        if (amountCents !== null)
            break;
    }
    let dueDate = null;
    for (const pattern of DUE_DATE_PATTERNS) {
        const match = text.match(pattern);
        if (match === null || match === void 0 ? void 0 : match[1]) {
            dueDate = parseDateToken(match[1]);
            if (dueDate)
                break;
        }
    }
    return { amountCents, currency, dueDate };
}
