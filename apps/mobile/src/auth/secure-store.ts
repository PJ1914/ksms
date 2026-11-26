import * as ExpoSecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * expo-secure-store on the phone. In a web browser (development preview on a laptop) SecureStore does
 * not exist, so the same three calls fall back to localStorage. The phone app is unchanged.
 */
const web = Platform.OS === 'web';

export function getItemAsync(key: string): Promise<string | null> {
  return web
    ? Promise.resolve(globalThis.localStorage?.getItem(key) ?? null)
    : ExpoSecureStore.getItemAsync(key);
}

export function setItemAsync(key: string, value: string): Promise<void> {
  if (!web) return ExpoSecureStore.setItemAsync(key, value);
  globalThis.localStorage?.setItem(key, value);
  return Promise.resolve();
}

export function deleteItemAsync(key: string): Promise<void> {
  if (!web) return ExpoSecureStore.deleteItemAsync(key);
  globalThis.localStorage?.removeItem(key);
  return Promise.resolve();
}
