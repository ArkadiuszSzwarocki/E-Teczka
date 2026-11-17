"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDevOverrides = getDevOverrides;
exports.setDevOverrides = setDevOverrides;
const planCatalog_1 = require("./planCatalog");
const state = {
    bypassDeviceLimit: false,
    bypassPlanLimits: false
};
function getDevOverrides() {
    if (!(0, planCatalog_1.catalogEnabled)())
        return { bypassDeviceLimit: false, bypassPlanLimits: false };
    return Object.assign({}, state);
}
function setDevOverrides(patch) {
    if (!(0, planCatalog_1.catalogEnabled)())
        return { bypassDeviceLimit: false, bypassPlanLimits: false };
    if (typeof patch.bypassDeviceLimit === 'boolean')
        state.bypassDeviceLimit = patch.bypassDeviceLimit;
    if (typeof patch.bypassPlanLimits === 'boolean')
        state.bypassPlanLimits = patch.bypassPlanLimits;
    return Object.assign({}, state);
}
