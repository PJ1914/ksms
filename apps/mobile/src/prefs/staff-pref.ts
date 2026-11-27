import { useCallback, useEffect, useState } from 'react';
import * as SecureStore from '@/auth/secure-store';

/**
 * Does this shop work with staff? An owner who runs the shop alone can hide all the staff options.
 * It is only a display choice kept on this phone (never a permission; the server decides who may do what).
 */
export type StaffPref = 'yes' | 'no' | 'unset';

const key = (organizationId: string) => `ksms.hasStaff.${organizationId}`;

export async function loadStaffPref(organizationId: string): Promise<StaffPref> {
  try {
    const v = await SecureStore.getItemAsync(key(organizationId));
    return v === 'yes' || v === 'no' ? v : 'unset';
  } catch {
    return 'unset';
  }
}

export async function saveStaffPref(organizationId: string, value: 'yes' | 'no'): Promise<void> {
  try {
    await SecureStore.setItemAsync(key(organizationId), value);
  } catch {
    // the choice then lasts until the app closes; nothing else depends on it
  }
}

/** `pref` is null while it is being read. */
export function useStaffPref(organizationId: string | undefined) {
  const [pref, setPref] = useState<StaffPref | null>(null);
  useEffect(() => {
    let live = true;
    setPref(null);
    if (!organizationId) return;
    void loadStaffPref(organizationId).then((v) => live && setPref(v));
    return () => {
      live = false;
    };
  }, [organizationId]);
  const set = useCallback(
    (value: 'yes' | 'no') => {
      setPref(value);
      if (organizationId) void saveStaffPref(organizationId, value);
    },
    [organizationId],
  );
  return { pref, set };
}
