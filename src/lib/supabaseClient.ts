import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Public Supabase project URL & publishable client key (safe in client bundles; protected by Postgres RLS)
const DEFAULT_SUPABASE_URL = 'https://aewkgzaatrtffcdxxaht.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_7Dbv0Ehlnf8HxQo7pQuUDQ_fjePtZbL';

const metaEnv = (import.meta as any).env || {};
export const supabaseProjectUrl = String(
  metaEnv.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
).trim();
export const supabasePublishableKey = String(
  metaEnv.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY
).trim();

export const isClientSupabaseConfigured = Boolean(
  supabaseProjectUrl &&
    !supabaseProjectUrl.includes('your-project-id') &&
    supabasePublishableKey &&
    supabasePublishableKey !== 'your_supabase_anon_public_key'
);

export const supabase: SupabaseClient | null = isClientSupabaseConfigured
  ? createClient(supabaseProjectUrl, supabasePublishableKey, {
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
