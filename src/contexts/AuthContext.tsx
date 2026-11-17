import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import type { PlanEntitlements, UserProfile } from '../types/auth.ts';
import { getPlanEntitlements } from '../utils/entitlements.ts';
import {
  isClientSupabaseConfigured,
  setActiveAccessToken,
  supabase,
} from '../lib/supabaseClient.ts';

interface AuthContextValue {
  isConfigured: boolean;
  isLoadingAuth: boolean;
  session: Session | null;
  profile: UserProfile | null;
  entitlements: PlanEntitlements;
  refreshProfile: () => Promise<void>;
  applyUpdatedProfile: (next: UserProfile) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function mapClientProfileRow(row: any, fallbackEmail = ''): UserProfile {
  return {
    id: String(row.id),
    email: String(row.email || fallbackEmail),
    fullName: String(row.full_name || ''),
    avatarUrl: String(row.avatar_url || ''),
    tier: row.tier === 'pro' ? 'pro' : 'free',
    proExpiresAt: row.pro_expires_at ? String(row.pro_expires_at) : null,
    role: row.role === 'admin' ? 'admin' : 'user',
  };
}

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isLoadingAuth, setIsLoadingAuth] = useState<boolean>(
    isClientSupabaseConfigured
  );
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);

  const fetchProfileForSession = useCallback(async (sess: Session | null) => {
    if (!supabase || !sess?.user) {
      setProfile(null);
      return;
    }

    const u = sess.user;
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', u.id)
      .maybeSingle();

    if (data) {
      setProfile(mapClientProfileRow(data, u.email));
    } else {
      const meta = u.user_metadata || {};
      setProfile({
        id: u.id,
        email: u.email || '',
        fullName: meta.full_name || meta.name || '',
        avatarUrl: meta.avatar_url || meta.picture || '',
        tier: 'free',
        proExpiresAt: null,
        role: 'user',
      });
    }
  }, []);

  useEffect(() => {
    if (!supabase) {
      setIsLoadingAuth(false);
      return;
    }

    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      const initialSession = data.session;
      setActiveAccessToken(initialSession?.access_token);
      setSession(initialSession);
      await fetchProfileForSession(initialSession);
      if (active) setIsLoadingAuth(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setActiveAccessToken(nextSession?.access_token);
        setSession(nextSession);
        fetchProfileForSession(nextSession);
      }
    );

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [fetchProfileForSession]);

  const refreshProfile = useCallback(async () => {
    await fetchProfileForSession(session);
  }, [fetchProfileForSession, session]);

  const applyUpdatedProfile = useCallback((next: UserProfile) => {
    setProfile(next);
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setActiveAccessToken('');
    setSession(null);
    setProfile(null);
  }, []);

  const entitlements = useMemo(() => getPlanEntitlements(profile), [profile]);

  const value = useMemo<AuthContextValue>(
    () => ({
      isConfigured: isClientSupabaseConfigured,
      isLoadingAuth,
      session,
      profile,
      entitlements,
      refreshProfile,
      applyUpdatedProfile,
      signOut,
    }),
    [
      isLoadingAuth,
      session,
      profile,
      entitlements,
      refreshProfile,
      applyUpdatedProfile,
      signOut,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
