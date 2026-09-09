import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured, getHostProfileByUserId, createOrEnsureHostProfile } from './supabase';
import { Profile, UserRole, HostProfile, HostStatus } from '../types/database';

interface SignUpParams {
  email: string;
  password: string;
  fullName: string;
  phone: string;
  country: string;
  accountType?: 'guest' | 'host';
}

interface AuthContextType {
  user: User | null;
  profile: Profile | null;
  hostProfile: HostProfile | null;
  isHost: boolean;
  hostStatus: HostStatus | null;
  session: Session | null;
  isAdmin: boolean;
  loading: boolean;
  isConfigured: boolean;
  signUp: (params: SignUpParams) => Promise<{ error: Error | null; message?: string; requiresVerification?: boolean }>;
  resendVerification: (email: string) => Promise<{ error: Error | null; success: boolean }>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  registerAsHost: () => Promise<{ error: Error | null; hostProfile?: HostProfile }>;
  // Dev mode toggle to test Admin vs Customer vs Host experience
  toggleDevRole: (role: UserRole | 'host') => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [hostProfile, setHostProfile] = useState<HostProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const isConfigured = isSupabaseConfigured();

  // Helper to fetch host profile from database or memory
  const fetchHostProfile = async (
    userId: string,
    userMetadata?: Record<string, any>
  ): Promise<HostProfile | null> => {
    if (!userId) return null;
    try {
      const existing = await getHostProfileByUserId(userId);
      if (existing) return existing;

      // If user metadata explicitly declared host account type during signup,
      // safely initialize host profile row now that user is confirmed and authenticated
      if (userMetadata?.account_type === 'host') {
        const created = await createOrEnsureHostProfile(userId, 'active');
        return created;
      }
    } catch (err) {
      console.warn('[AUTH] Warning fetching host profile:', err);
    }
    return null;
  };

  // Helper to fetch profile from database
  const fetchProfile = async (
    userId: string,
    emailStr: string,
    userMetadata?: Record<string, any>
  ): Promise<Profile | null> => {
    if (!isConfigured) {
      return {
        id: userId,
        full_name: 'Guest User',
        email: emailStr,
        phone: '+2348012345678',
        country: 'Nigeria',
        role: 'customer',
        created_at: new Date().toISOString(),
      };
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data) {
        return {
          ...data,
          email: emailStr,
        } as Profile;
      }

      // If user is authenticated and profile row does not exist yet, create default customer profile row
      if (!error && !data && userId) {
        const profileRow = {
          id: userId,
          full_name: userMetadata?.full_name || 'Customer Account',
          phone: userMetadata?.phone || '',
          country: userMetadata?.country || '',
          role: 'customer' as UserRole,
        };
        const { data: inserted, error: insertErr } = await supabase
          .from('profiles')
          .insert(profileRow)
          .select()
          .maybeSingle();

        if (!insertErr && inserted) {
          return {
            ...inserted,
            email: emailStr,
          } as Profile;
        }
      }

      if (error) {
        console.warn('[AUTH] Warning fetching user profile:', error.message);
      }
    } catch (err) {
      console.warn('[AUTH] Error fetching user profile:', err);
    }
    // Default return: strictly customer role
    return {
      id: userId,
      full_name: userMetadata?.full_name || 'Registered User',
      email: emailStr,
      role: 'customer',
      created_at: new Date().toISOString(),
    };
  };

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    // Get initial session
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const [p, hp] = await Promise.all([
          fetchProfile(session.user.id, session.user.email || '', session.user.user_metadata),
          fetchHostProfile(session.user.id, session.user.user_metadata),
        ]);
        setProfile(p);
        setHostProfile(hp);
      }
      setLoading(false);
    });

    // Listen for auth state changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const [p, hp] = await Promise.all([
          fetchProfile(session.user.id, session.user.email || '', session.user.user_metadata),
          fetchHostProfile(session.user.id, session.user.user_metadata),
        ]);
        setProfile(p);
        setHostProfile(hp);
      } else {
        setProfile(null);
        setHostProfile(null);
      }
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [isConfigured]);

  const getEmailRedirectUrl = () => {
    if (typeof window !== 'undefined' && window.location.origin) {
      const origin = window.location.origin;
      if (!origin.includes('localhost') && !origin.includes('127.0.0.1')) {
        return `${origin}/login?confirmed=true`;
      }
    }
    return 'https://the-ark-rooms-test.vercel.app/login?confirmed=true';
  };

  const formatAuthError = (err: any): Error => {
    // Development logging: log exact error message, code, status, name for debugging
    console.error('[Supabase Auth Error Details]', {
      message: err?.message,
      code: err?.code || err?.status,
      status: err?.status,
      name: err?.name,
      raw: err,
    });

    const rawMsg = (err?.message || String(err || '')).toLowerCase();
    if (
      rawMsg.includes('invalid login credentials') ||
      rawMsg.includes('invalid_credentials') ||
      rawMsg.includes('invalid password') ||
      rawMsg.includes('user not found')
    ) {
      return new Error('Incorrect email or password.');
    }
    if (rawMsg.includes('already registered') || rawMsg.includes('user_already_exists')) {
      return new Error('Email is already registered. Please sign in instead.');
    }
    if (rawMsg.includes('weak') || rawMsg.includes('at least 6 characters')) {
      return new Error('Password is too weak. Please use at least 6 characters.');
    }
    if (rawMsg.includes('email not confirmed') || rawMsg.includes('unconfirmed')) {
      return new Error('Please verify your email address before signing in.');
    }
    if (
      rawMsg.includes('rate limit') ||
      rawMsg.includes('over_email_send_rate_limit') ||
      rawMsg.includes('once every') ||
      rawMsg.includes('security purposes')
    ) {
      return new Error('Too many requests. Please wait a minute before requesting another confirmation email.');
    }
    if (
      rawMsg.includes('failed to fetch') ||
      rawMsg.includes('networkerror') ||
      rawMsg.includes('aborterror') ||
      rawMsg.includes('enotfound') ||
      rawMsg.includes('load failed')
    ) {
      return new Error('Unable to connect to authentication service. Please check your internet connection and try again.');
    }
    return new Error(err?.message || 'Authentication failed. Please try again.');
  };

  const signUp = async ({ email, password, fullName, phone, country, accountType = 'guest' }: SignUpParams) => {
    if (!isConfigured) {
      // Simulate auth for testing when env vars aren't configured yet
      const mockId = `usr-${Date.now()}`;
      const mockProfile: Profile = {
        id: mockId,
        full_name: fullName,
        email,
        phone,
        country,
        role: 'customer', // strictly defaults to customer
        created_at: new Date().toISOString(),
      };
      setProfile(mockProfile);

      if (accountType === 'host') {
        const mockHost: HostProfile = {
          id: `hp-${Date.now()}`,
          user_id: mockId,
          host_status: 'active',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        setHostProfile(mockHost);
      } else {
        setHostProfile(null);
      }

      setUser({
        id: mockId,
        email,
        app_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        user_metadata: {
          full_name: fullName,
          phone,
          country,
          account_type: accountType,
        },
      } as unknown as User);
      return { error: null };
    }

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            full_name: fullName,
            phone,
            country,
            account_type: accountType,
          },
          emailRedirectTo: getEmailRedirectUrl(),
        },
      });

      if (error) return { error: formatAuthError(error) };

      if (data.user) {
        // If user already exists and Supabase has email enumeration protection enabled,
        // identities array is empty
        if (Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          return {
            error: new Error('Email is already registered. Please sign in instead.'),
          };
        }

        // Upsert into profiles table with role strictly defaulted to 'customer'
        // CRITICAL: Guests and Hosts are both 'customer' in profiles.role; host capability is determined via host_profiles
        const profileRow = {
          id: data.user.id,
          full_name: fullName,
          phone,
          country,
          role: 'customer' as UserRole, // Always customer on signup, NEVER admin
        };

        // Only perform immediate direct profile write if an active authenticated session is present
        if (data.session) {
          const { error: profileError } = await supabase.from('profiles').upsert(profileRow);
          if (profileError) {
            console.warn('Failed to upsert profile record:', profileError);
          } else {
            setProfile({
              ...profileRow,
              email,
              created_at: new Date().toISOString(),
            });
          }

          if (accountType === 'host') {
            const hp = await createOrEnsureHostProfile(data.user.id, 'active');
            setHostProfile(hp);
          }
        }

        // Handle email verification requirement when session is not yet active
        if (!data.session) {
          return {
            error: null,
            message: `We've sent a registration link to ${email}. Please open your email and click the confirmation link to activate your account.`,
            requiresVerification: true,
          };
        }
      }

      return { error: null };
    } catch (err: any) {
      return { error: formatAuthError(err) };
    }
  };

  const resendVerification = async (targetEmail: string) => {
    if (!isConfigured) {
      return { error: null, success: true };
    }
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email: targetEmail,
        options: {
          emailRedirectTo: getEmailRedirectUrl(),
        },
      });

      if (error) {
        return { error: formatAuthError(error), success: false };
      }
      return { error: null, success: true };
    } catch (err: any) {
      return { error: formatAuthError(err), success: false };
    }
  };

  const signIn = async (email: string, password: string) => {
    if (!isConfigured) {
      // Local fallback simulation - strictly defaults to customer role. No email-based promotion.
      const mockId = `usr-${Date.now()}`;
      const mockProfile: Profile = {
        id: mockId,
        full_name: 'Customer Account',
        email,
        phone: '+2348012345678',
        country: 'Nigeria',
        role: 'customer',
        created_at: new Date().toISOString(),
      };
      setProfile(mockProfile);
      setHostProfile(null);
      setUser({ id: mockId, email } as User);
      return { error: null };
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return { error: formatAuthError(error) };

      if (data.user) {
        const [p, hp] = await Promise.all([
          fetchProfile(data.user.id, data.user.email || '', data.user.user_metadata),
          fetchHostProfile(data.user.id, data.user.user_metadata),
        ]);
        setProfile(p);
        setHostProfile(hp);
      }

      return { error: null };
    } catch (err: any) {
      return { error: formatAuthError(err) };
    }
  };

  const signOut = async () => {
    if (isConfigured) {
      await supabase.auth.signOut();
    }
    setUser(null);
    setSession(null);
    setProfile(null);
    setHostProfile(null);
  };

  // Allows an existing authenticated guest to activate host status voluntarily
  const registerAsHost = async (): Promise<{ error: Error | null; hostProfile?: HostProfile }> => {
    if (!user) {
      return { error: new Error('You must be signed in to become a host.') };
    }
    try {
      const hp = await createOrEnsureHostProfile(user.id, 'active');
      setHostProfile(hp);
      return { error: null, hostProfile: hp };
    } catch (err: any) {
      return { error: new Error(err.message || 'Failed to initialize host account.') };
    }
  };

  // Development-only role toggle, strictly disabled in production builds
  const toggleDevRole = (targetRole: UserRole | 'host') => {
    if (!import.meta.env.DEV) {
      console.warn('[AUTH] Dev role switching is disabled in production environments.');
      return;
    }
    if (!user) {
      setUser({
        id: 'dev-user-id',
        email: 'dev@thearkrooms.com',
        app_metadata: {},
        aud: 'authenticated',
        created_at: new Date().toISOString(),
        user_metadata: { account_type: targetRole === 'host' ? 'host' : 'guest' },
      } as unknown as User);
    }
    if (targetRole === 'host') {
      setProfile((prev) => ({
        id: prev?.id || 'dev-user-id',
        full_name: 'Verified Apartment Host',
        email: prev?.email || 'host@thearkrooms.com',
        role: 'customer',
        created_at: prev?.created_at || new Date().toISOString(),
      }));
      setHostProfile({
        id: 'hp-dev-user-id',
        user_id: user?.id || 'dev-user-id',
        host_status: 'active',
        created_at: new Date().toISOString(),
      });
    } else {
      setProfile((prev) => ({
        id: prev?.id || 'dev-user-id',
        full_name: targetRole === 'admin' ? 'Operations Admin' : 'Event Attendee',
        email: prev?.email || 'dev@thearkrooms.com',
        role: targetRole,
        created_at: prev?.created_at || new Date().toISOString(),
      }));
      setHostProfile(null);
    }
  };

  // Authoritative admin determination: strictly derived from authenticated user and database profile role
  const isAdmin = Boolean(user && profile?.role === 'admin');

  // Host determination: authenticated user who has an active/pending host profile or host account metadata
  const isHost = Boolean(
    user && (
      (hostProfile !== null && hostProfile.host_status !== 'suspended') ||
      user.user_metadata?.account_type === 'host'
    )
  );

  const hostStatus: HostStatus | null =
    hostProfile?.host_status || (user?.user_metadata?.account_type === 'host' ? 'active' : null);

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        hostProfile,
        isHost,
        hostStatus,
        session,
        isAdmin,
        loading,
        isConfigured,
        signUp,
        resendVerification,
        signIn,
        signOut,
        registerAsHost,
        toggleDevRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
