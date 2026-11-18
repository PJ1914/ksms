import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { ApiError, createApiClient } from '@ksms/api-client';
import { API_URL } from '@/config';
import { randomUuid } from '@/utils/uuid';

/** What the API returns about the signed-in person (GET /auth/me and every sign-in). */
export interface Profile {
  user: { id: string; fullName: string; phone: string | null; email: string | null };
  organization: { id: string; name: string; gstEnabled: boolean; currency: string };
  role: { id: string; name: string };
  branches: { id: string; code: string; name: string; isDefault: boolean }[];
  permissions: string[];
}

interface AuthResponse extends Profile {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export interface RegisterInput {
  fullName: string;
  phone: string;
  password: string;
  shopName: string;
}

// The refresh token lives in the phone's encrypted store (Android Keystore). The short-lived
// access token is kept in memory only, so it is gone when the app closes.
const REFRESH_KEY = 'ksms.refreshToken';
const DEVICE_KEY = 'ksms.deviceUid';
const REFRESH_EARLY_MS = 30_000;

let access: { token: string; expiresAt: number } | null = null;
let branchId: string | null = null;
let refreshing: Promise<Profile | null> | null = null;
let onSignedOut: (() => void) | null = null;

/** Used only for sign-in and refresh calls, which must not try to attach (or refresh) a token. */
const publicApi = createApiClient({ baseUrl: API_URL, getAccessToken: async () => null });

/** The client every screen uses: adds the token (refreshing it first if needed) and the branch. */
export const api = createApiClient({
  baseUrl: API_URL,
  getAccessToken: () => validAccessToken(),
  getBranchId: () => branchId,
});

/** Which branch the app works in (sent as X-Branch-Id). Must be one of the user's branches. */
export function setActiveBranch(id: string | null): void {
  branchId = id;
}

export function getActiveBranch(): string | null {
  return branchId;
}

export function setSignedOutListener(fn: (() => void) | null): void {
  onSignedOut = fn;
}

async function deviceInfo() {
  let uid = await SecureStore.getItemAsync(DEVICE_KEY);
  if (!uid) {
    uid = randomUuid();
    await SecureStore.setItemAsync(DEVICE_KEY, uid);
  }
  return {
    deviceUid: uid,
    deviceName: Constants.deviceName ?? undefined,
    appVersion: Constants.expoConfig?.version,
  };
}

async function accept(r: AuthResponse): Promise<Profile> {
  await SecureStore.setItemAsync(REFRESH_KEY, r.refreshToken);
  access = { token: r.accessToken, expiresAt: Date.now() + r.expiresIn * 1000 };
  branchId = (r.branches.find((b) => b.isDefault) ?? r.branches[0])?.id ?? null;
  // Tokens never leave this file: screens get the profile only.
  return {
    user: r.user,
    organization: r.organization,
    role: r.role,
    branches: r.branches,
    permissions: r.permissions,
  };
}

async function clear(): Promise<void> {
  access = null;
  branchId = null;
  await SecureStore.deleteItemAsync(REFRESH_KEY);
}

export async function signIn(
  identifier: string,
  password: string,
  organizationId?: string,
): Promise<Profile> {
  const res = await publicApi.post<{ data: AuthResponse }>('/auth/login', {
    identifier: identifier.trim(),
    password,
    ...(organizationId ? { organizationId } : {}),
    ...(await deviceInfo()),
  });
  return accept(res.data);
}

export async function registerShop(input: RegisterInput): Promise<Profile> {
  const res = await publicApi.post<{ data: AuthResponse }>('/auth/register-owner', {
    fullName: input.fullName.trim(),
    phone: input.phone.trim(),
    password: input.password,
    shopName: input.shopName.trim(),
    ...(await deviceInfo()),
  });
  return accept(res.data);
}

/**
 * Exchanges the stored refresh token for a new session. Returns null when there is no session
 * (or the server says it is no longer valid). Network errors are thrown so the app can offer a retry
 * instead of signing the user out. Concurrent callers share one request: the server rotates refresh
 * tokens and treats reuse of an old one as theft.
 */
export function refreshSession(): Promise<Profile | null> {
  refreshing ??= (async () => {
    try {
      const token = await SecureStore.getItemAsync(REFRESH_KEY);
      if (!token) return null;
      try {
        const res = await publicApi.post<{ data: AuthResponse }>('/auth/refresh', {
          refreshToken: token,
        });
        return await accept(res.data);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await clear();
          return null;
        }
        throw e;
      }
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

async function validAccessToken(): Promise<string | null> {
  if (access && access.expiresAt - Date.now() > REFRESH_EARLY_MS) return access.token;
  const profile = await refreshSession();
  if (!profile) {
    onSignedOut?.();
    return null;
  }
  return access?.token ?? null;
}

export async function signOut(): Promise<void> {
  try {
    if (access) await api.post('/auth/logout');
  } catch {
    // Signing out on this phone must work even when offline; the server session expires on its own.
  } finally {
    await clear();
  }
}
