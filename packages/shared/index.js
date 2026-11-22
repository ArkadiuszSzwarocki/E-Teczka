'use strict';

const APP_BRAND = Object.freeze({
  name: 'MojaTeczka',
  appId: 'pl.arecki.mojateczka',
});

const PLAN_IDS = Object.freeze(['free', 'standard', 'premium', 'family', 'business']);

const PLAN_LABELS_PL = Object.freeze({
  free: 'Darmowy',
  standard: 'Standard',
  premium: 'Premium',
  family: 'Rodzinny',
  business: 'Firmowy',
});

const API_ERROR_CODES = Object.freeze({
  DEVICE_REVOKED: 'DEVICE_REVOKED',
  DEVICE_LIMIT_REACHED: 'DEVICE_LIMIT_REACHED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  PREMIUM_REQUIRED: 'PREMIUM_REQUIRED',
  OCR_UNAVAILABLE: 'OCR_UNAVAILABLE',
  CENTRAL_ACCOUNT_REQUIRED: 'CENTRAL_ACCOUNT_REQUIRED',
});

module.exports = {
  APP_BRAND,
  PLAN_IDS,
  PLAN_LABELS_PL,
  API_ERROR_CODES,
};
