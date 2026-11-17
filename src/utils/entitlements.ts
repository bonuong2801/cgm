import type {
  PlanEntitlements,
  PlanId,
  UserProfile,
} from '../types/auth.ts';

export const FREE_MAX_EXPORT_FILES = 20;
export const FREE_MAX_LOGO_LAYERS = 1;

/**
 * Computes effective feature entitlements from a user profile.
 * Automatically downgrades expired time-bound Pro subscriptions back to Free limits.
 */
export function getPlanEntitlements(
  profile: UserProfile | null | undefined,
  nowMs: number = Date.now()
): PlanEntitlements {
  const isPro = Boolean(
    profile &&
      profile.tier === 'pro' &&
      (!profile.proExpiresAt || Date.parse(profile.proExpiresAt) > nowMs)
  );

  return {
    isPro,
    maxExportFilesPerRun: isPro
      ? Number.POSITIVE_INFINITY
      : FREE_MAX_EXPORT_FILES,
    maxLogoLayers: isPro ? Number.POSITIVE_INFINITY : FREE_MAX_LOGO_LAYERS,
    canFreeDragLogo: isPro,
    canSaveLogoPresets: isPro,
    canUseAiCull: isPro,
    canExportOriginalOr4K: isPro,
    canExportPngOrMaxQuality: isPro,
    canCustomBatchRename: isPro,
    canIncludeVideosInExport: isPro,
  };
}

/**
 * Extracts a `CGM` + 6..8 digit payment order code from any Vietnamese bank transfer description
 * (handles MB Bank, Vietcombank, ACB, Techcombank, BIDV formats like `MBVCB.9283.CGM839214.CT TU...`).
 */
export function extractOrderCodeFromTransferContent(
  content: string | null | undefined
): string | null {
  if (!content) return null;
  const match = content.match(/(?:^|[^A-Z0-9])(CGM\d{6,8})(?=$|[^0-9])/i);
  return match?.[1] ? match[1].toUpperCase() : null;
}

export function formatVndCurrency(amountVnd: number): string {
  return `${Math.round(amountVnd).toLocaleString('vi-VN')}đ`;
}

export function getPlanDurationDays(planId: PlanId): number | null {
  if (planId === 'monthly') return 30;
  if (planId === 'yearly') return 365;
  return null;
}
