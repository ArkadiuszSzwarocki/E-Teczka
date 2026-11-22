export type PlanId = 'free' | 'standard' | 'premium' | 'family' | 'business';

export declare const APP_BRAND: Readonly<{
  name: 'MojaTeczka';
  appId: 'pl.arecki.mojateczka';
}>;

export declare const PLAN_IDS: readonly PlanId[];

export declare const PLAN_LABELS_PL: Readonly<Record<PlanId, string>>;

export declare const API_ERROR_CODES: Readonly<{
  DEVICE_REVOKED: 'DEVICE_REVOKED';
  DEVICE_LIMIT_REACHED: 'DEVICE_LIMIT_REACHED';
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED';
  PREMIUM_REQUIRED: 'PREMIUM_REQUIRED';
  OCR_UNAVAILABLE: 'OCR_UNAVAILABLE';
  CENTRAL_ACCOUNT_REQUIRED: 'CENTRAL_ACCOUNT_REQUIRED';
}>;
