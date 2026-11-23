import { setCacheScope } from '@/api/swr-cache';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { wipeLocalSyncCache } from '@/sync/expo-db';
import {
  type Profile,
  getActiveBranch,
  setActiveBranch,
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
  signIn: (identifier: string, password: string, organizationId?: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  signOut: () => Promise<void>;
  /** Tries again to restore the saved session after a network problem at start-up. */
  retry: () => void;
  can: (permission: string) => boolean;
  /** The branch the app is working in right now. */
  branch: { id: string; code: string; name: string } | null;
  switchBranch: (id: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [profile, setProfile] = useState<Profile | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);

  const restore = useCallback(() => {
    setStatus('loading');
    refreshSession()
      .then((p) => {
        setProfile(p);
        setBranchId(getActiveBranch());
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

  // Cached screen data belongs to one user + branch; switching either clears it.
  setCacheScope(`${profile?.user.id ?? 'none'}:${branchId ?? 'none'}`);

  const value = useMemo<AuthState>(
    () => ({
      status,
      profile,
      signIn: async (identifier, password, organizationId) => {
        setProfile(await signIn(identifier, password, organizationId));
        setBranchId(getActiveBranch());
        setStatus('signedIn');
      },
      register: async (input) => {
        setProfile(await registerShop(input));
        setBranchId(getActiveBranch());
        setStatus('signedIn');
      },
      signOut: async () => {
        await wipeLocalSyncCache();
        await signOut();
        setProfile(null);
        setStatus('signedOut');
      },
      retry: restore,
      can: (permission) =>
        profile?.role.name === 'Owner' || (profile?.permissions.includes(permission) ?? false),
      branch: profile?.branches.find((b) => b.id === branchId) ?? null,
      switchBranch: (id) => {
        if (!profile?.branches.some((b) => b.id === id)) return;
        setActiveBranch(id);
        setBranchId(id);
      },
    }),
    [status, profile, branchId, restore],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
