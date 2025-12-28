import { defineConfig } from 'vite'
import path from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

export default defineConfig({
  base: './',   // Ensure relative paths for assets
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        // Prevent bundling heavy native/node modules used by Playwright/Electron.
        // Treat them as external so they are required at runtime from node_modules.
        vite: {
          build: {
            rollupOptions: {
              external: [
                'playwright',
                'playwright-core',
                'chromium-bidi',
                'chromium-bidi/lib/cjs/bidiMapper/BidiMapper'
              ]
            }
          }
        },
      },
      preload: {
        input: 'electron/preload.ts',
      },
      renderer: {},
    }),
  ],
})