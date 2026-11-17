import { catalogEnabled } from './planCatalog';

export type DevOverrides = {
  bypassDeviceLimit: boolean;
  bypassPlanLimits: boolean;
};

const state: DevOverrides = {
  bypassDeviceLimit: false,
  bypassPlanLimits: false
};

export function getDevOverrides(): DevOverrides {
  if (!catalogEnabled()) return { bypassDeviceLimit: false, bypassPlanLimits: false };
  return { ...state };
}

export function setDevOverrides(patch: Partial<DevOverrides>): DevOverrides {
  if (!catalogEnabled()) return { bypassDeviceLimit: false, bypassPlanLimits: false };
  if (typeof patch.bypassDeviceLimit === 'boolean') state.bypassDeviceLimit = patch.bypassDeviceLimit;
  if (typeof patch.bypassPlanLimits === 'boolean') state.bypassPlanLimits = patch.bypassPlanLimits;
  return { ...state };
}
