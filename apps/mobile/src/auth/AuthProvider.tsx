import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  type Profile,
  type RegisterInput,
  refreshSession,
  registerShop,
  setSignedOutListener,
  signIn,
  signOut,
} from './session';

type Status = 'loading' | 'signedOut' | 'signedIn' | 'offline';

interface AuthState {
  status: Status;
  profile: Profile | null;
  signIn: (identifier: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  /** Tries again to restore the saved session after a network problem at start-up. */
  retry: () => void;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);

  const restore = useCallback(() => {
    setStatus('loading');
    refreshSession()
      .then((p) => {
        setProfile(p);
        setStatus(p ? 'signedIn' : 'signedOut');
      })
      .catch(() => setStatus('offline'));
  }, []);

  useEffect(() => {
    restore();
    setSignedOutListener(() => {
      setProfile(null);
      setStatus('signedOut');
    });
    return () => setSignedOutListener(null);
  }, [restore]);

  const value = useMemo<AuthState>(
    () => ({
      status,
      profile,
      signIn: async (identifier, password) => {
        setProfile(await signIn(identifier, password));
        setStatus('signedIn');
      },
      register: async (input) => {
        setProfile(await registerShop(input));
        setStatus('signedIn');
      },
      signOut: async () => {
        await signOut();
        setProfile(null);
        setStatus('signedOut');
      },
      retry: restore,
      can: (permission) => profile?.permissions.includes(permission) ?? false,
    }),
    [status, profile, restore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
