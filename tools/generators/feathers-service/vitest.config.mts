import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'

// Ohne tsconfig.spec.json — das Generator-Tool hat ueberhaupt keine tsconfig
// und damit kein typecheck-Target. Specs gehoeren neben generator.ts und
// laufen ueber `@nx/devkit/testing` (createTreeWithEmptyWorkspace).
//
// `files/` bleibt aussen vor: Das sind EJS-Templates mit `__tmpl__`-Endung,
// kein kompilierbarer Code.
export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../node_modules/.vite/tools/generators/feathers-service',
  plugins: [nxViteTsPaths()],
  test: {
    name: 'feathers-service-generator',
    watch: false,
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['*.{test,spec}.{js,mjs,cjs,ts,mts,cts}', '{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../coverage/tools/generators/feathers-service',
      provider: 'v8' as const,
    },
  },
}))
