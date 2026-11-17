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
exports.verifyGooglePlaySubscription = verifyGooglePlaySubscription;
/**
 * Verifies a Google Play subscription purchase token via Android Publisher API v3.
 * Requires ETECZKA_GOOGLE_PLAY_ACCESS_TOKEN (or a custom verifyFetch in tests).
 */
function verifyGooglePlaySubscription(input_1) {
    return __awaiter(this, arguments, void 0, function* (input, accessToken = process.env.ETECZKA_GOOGLE_PLAY_ACCESS_TOKEN || '', request = fetch) {
        var _a, _b, _c;
        if (!input.packageName || !input.subscriptionId || !input.purchaseToken) {
            throw new Error('INVALID_PURCHASE_INPUT');
        }
        if (!accessToken) {
            throw new Error('GOOGLE_PLAY_NOT_CONFIGURED');
        }
        const url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(input.packageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`;
        const response = yield request(url, {
            headers: { Authorization: `Bearer ${accessToken}` },
            redirect: 'error',
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok)
            throw new Error('GOOGLE_PLAY_VERIFY_FAILED');
        const payload = yield response.json();
        const active = payload.subscriptionState === 'SUBSCRIPTION_STATE_ACTIVE' || payload.subscriptionState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD';
        const expiryIso = (_b = (_a = payload.lineItems) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.expiryTime;
        const expiryTimeMillis = expiryIso ? Date.parse(expiryIso) : null;
        return {
            active,
            expiryTimeMillis: Number.isFinite(expiryTimeMillis) ? expiryTimeMillis : null,
            orderId: (_c = payload.latestOrderId) !== null && _c !== void 0 ? _c : null
        };
    });
}
