import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Public Supabase project URL, publishable client key & Google Web OAuth Client ID (public identifiers; protected by RLS & token verification)
const DEFAULT_SUPABASE_URL = 'https://aewkgzaatrtffcdxxaht.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY =
  'sb_publishable_7Dbv0Ehlnf8HxQo7pQuUDQ_fjePtZbL';
const DEFAULT_GOOGLE_WEB_CLIENT_ID =
  '766080458651-ajne6147j3ldhu8p6o3dgj8tq3lro65f.apps.googleusercontent.com';

const metaEnv = (import.meta as any).env || {};
export const supabaseProjectUrl = String(
  metaEnv.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL
).trim();
export const supabasePublishableKey = String(
  metaEnv.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_PUBLISHABLE_KEY
).trim();
export const googleWebClientId = String(
  metaEnv.VITE_GOOGLE_CLIENT_ID || DEFAULT_GOOGLE_WEB_CLIENT_ID
).trim();

/**
 * Generates a cryptographic raw nonce (for Supabase `signInWithIdToken`) and its
 * SHA-256 hex digest (for Google Identity Services `nonce` parameter).
 */
export async function generateGoogleNoncePair(): Promise<{
  nonce: string;
  hashedNonce: string;
}> {
  const randomBytes = new Uint8Array(24);
  crypto.getRandomValues(randomBytes);
  const nonce = Array.from(randomBytes, (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  const hashBuffer = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(nonce)
  );
  const hashedNonce = Array.from(new Uint8Array(hashBuffer), (b) =>
    b.toString(16).padStart(2, '0')
  ).join('');
  return { nonce, hashedNonce };
}

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
  if (
    !latestAccessToken ||
    !url.startsWith('/api/drive/stream') ||
    url.includes('token=')
  ) {
    return url;
  }
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}token=${encodeURIComponent(latestAccessToken)}`;
}
