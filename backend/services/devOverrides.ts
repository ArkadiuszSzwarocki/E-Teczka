import { catalogEnabled } from './planCatalog';

export type DevOverrides = {
  bypassDeviceLimit: boolean;
  bypassPlanLimits: boolean;
  bypassRateLimit: boolean;
};

const state: DevOverrides = {
  bypassDeviceLimit: false,
  bypassPlanLimits: false,
  bypassRateLimit: false,
};

export function getDevOverrides(): DevOverrides {
  if (!catalogEnabled()) return { bypassDeviceLimit: false, bypassPlanLimits: false, bypassRateLimit: false };
  return { ...state };
}

export function setDevOverrides(patch: Partial<DevOverrides>): DevOverrides {
  if (!catalogEnabled()) return { bypassDeviceLimit: false, bypassPlanLimits: false, bypassRateLimit: false };
  if (typeof patch.bypassDeviceLimit === 'boolean') state.bypassDeviceLimit = patch.bypassDeviceLimit;
  if (typeof patch.bypassPlanLimits === 'boolean') state.bypassPlanLimits = patch.bypassPlanLimits;
  if (typeof patch.bypassRateLimit === 'boolean') state.bypassRateLimit = patch.bypassRateLimit;
  return { ...state };
}
