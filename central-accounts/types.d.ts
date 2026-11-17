export type PlanId = 'free' | 'standard' | 'premium' | 'family' | 'business';
export type LimitKey = 'documents' | 'tags' | 'cameraScan' | 'printerScan' | 'merge';
export type TrialFeature = 'ocr' | 'cloudBackup';
export type MeteredFeature = 'cameraScan' | 'printerScan' | 'merge';

export interface PlanSettings {
  name: string;
  ocr: boolean;
  cloudBackup: boolean;
  premiumTools: boolean;
  monthly: number;
  yearly: number;
  mobileDevices: number;
  accountDevices: number | null;
  limits: Record<LimitKey, number | null>;
}

export interface Promotion {
  id: string;
  name: string;
  plan: PlanId;
  interval: 'monthly' | 'yearly';
  percent: number;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
}

export interface Catalog {
  version: 1;
  usageDays: number;
  ocrTrialDays: number;
  standardOcrTrialDays?: number;
  backupTrialMonths: number;
  plans: Record<PlanId, PlanSettings>;
  promotions: Promotion[];
}

export interface TrialResult {
  allowed: boolean;
  startedAt: string | null;
  endsAt: string | null;
}
