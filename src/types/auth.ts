export type AccountTier = 'free' | 'pro';
export type UserRole = 'user' | 'admin';
export type PlanId = 'monthly' | 'yearly' | 'lifetime';

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  avatarUrl: string;
  tier: AccountTier;
  proExpiresAt: string | null; // ISO timestamp or null for Lifetime Pro
  role: UserRole;
}

export interface PlanEntitlements {
  isPro: boolean;
  maxExportFilesPerRun: number;
  maxLogoLayers: number;
  canFreeDragLogo: boolean;
  canSaveLogoPresets: boolean;
  canExportOriginalOr4K: boolean;
  canExportPngOrMaxQuality: boolean;
  canCustomBatchRename: boolean;
  canIncludeVideosInExport: boolean;
}

export interface BillingPlanOption {
  id: PlanId;
  name: string;
  badge?: string;
  durationLabel: string;
  amountVnd: number;
}

export interface VietQrOrderResponse {
  orderCode: string;
  planId: PlanId;
  amountVnd: number;
  qrImageUrl: string;
  bankId: string;
  accountNo: string;
  accountName: string;
  expiresAt: string;
}

export interface LicenseKeyRecord {
  code: string;
  plan_type: PlanId;
  duration_days: number | null;
  max_uses: number;
  used_count: number;
  is_active: boolean;
  note: string | null;
  created_at: string;
}
