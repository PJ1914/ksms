import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Admin panel (ADMIN_PANEL.md Phase C). VITE_API_ORIGIN is the API's origin, e.g. https://api.example.com
export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: false },
  build: { outDir: 'dist', sourcemap: false },
});
