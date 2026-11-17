import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const metaEnv = (import.meta as any).env || {};
const rawUrl = String(metaEnv.VITE_SUPABASE_URL || '').trim();
const rawAnonKey = String(metaEnv.VITE_SUPABASE_ANON_KEY || '').trim();

export const isClientSupabaseConfigured = Boolean(
  rawUrl &&
    !rawUrl.includes('your-project-id') &&
    rawAnonKey &&
    rawAnonKey !== 'your_supabase_anon_public_key'
);

export const supabase: SupabaseClient | null = isClientSupabaseConfigured
  ? createClient(rawUrl, rawAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

let latestAccessToken = '';

export function setActiveAccessToken(token: string | null | undefined): void {
  latestAccessToken = token || '';
}

export function getActiveAccessToken(): string {
  return latestAccessToken;
}

export function getAuthHeaders(): Record<string, string> {
  return latestAccessToken
    ? { Authorization: `Bearer ${latestAccessToken}` }
    : {};
}

/**
 * Dynamically appends the freshest Supabase access token to `/api/drive/stream` URLs
 * so HTML5 `<video>` tags and background Web Workers remain authenticated across token refreshes.
 */
export function attachAuthToStreamUrl(url: string): string {
  if (!latestAccessToken || !url.startsWith('/api/drive/stream')) {
    return url;
  }
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(latestAccessToken)}`;
}
