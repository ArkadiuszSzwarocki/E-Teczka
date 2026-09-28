"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorMessage = errorMessage;
exports.hasErrorCode = hasErrorCode;
exports.errorStatusCode = errorStatusCode;
/** Safe display text for unknown runtime errors. */
function errorMessage(error, fallback = 'Nieznany błąd.') {
    return error instanceof Error && error.message ? error.message : fallback;
}
/** Prisma errors expose their stable code as a string, but are not always Error instances. */
function hasErrorCode(error, code) {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && error.code === code;
}
function errorStatusCode(error) {
    if (!error || typeof error !== 'object' || !('statusCode' in error))
        return null;
    const statusCode = error.statusCode;
    return typeof statusCode === 'number' && Number.isInteger(statusCode) ? statusCode : null;
}
