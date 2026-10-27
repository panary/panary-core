import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'

// Ohne tsconfig.spec.json — anders als bei den Libs. tse-gateway hat keine
// tsconfig.json, sondern nur eine tsconfig.app.json, und dadurch kein
// typecheck-Target; eine spec-tsconfig haette hier nichts, woran sie haengt.
// Die tsconfig.app.json schliesst `src/**/*.spec.ts` bereits aus, Specs landen
// also nicht im Build.
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/tse-gateway',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'tse-gateway',
    watch: false,
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/tse-gateway',
      provider: 'v8' as const,
    },
  },
}))
