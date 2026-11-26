/* eslint-disable @typescript-eslint/no-require-imports */
// Expo's defaults (they already handle this pnpm monorepo), plus what expo-sqlite needs to run in a
// web browser (`pnpm --filter @ksms/mobile web`): load its .wasm file and send the two headers that let
// its worker use SharedArrayBuffer. Neither affects the Android build.
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('wasm');

config.server.enhanceMiddleware = (middleware) => (req, res, next) => {
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  return middleware(req, res, next);
};

module.exports = config;
