/**
 * Where the app finds the API. Set EXPO_PUBLIC_API_URL in apps/mobile/.env.
 * On a phone this must be the PC's Wi-Fi address (e.g. http://192.168.1.10:3000/api/v1), not localhost.
 * EXPO_PUBLIC_* values are bundled into the app and are public: never put secrets here.
 */
export const API_URL = (process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1').replace(
  /\/+$/,
  '',
);
