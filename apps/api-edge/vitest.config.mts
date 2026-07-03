import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'
import { join } from 'path'

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/apps/api-edge',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'api-edge',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,test,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    // Legt data/ an und migriert die Test-DB einmalig vor dem Worker-Start —
    // verhindert das Erst-Migrations-Race paralleler Worker (CI: frisches data/).
    globalSetup: ['./test/global-setup.ts'],
    // Die Integrationstests unter test/ importieren src/app: node-config braucht den
    // Config-Pfad (cwd des Vitest-Workers ist der Workspace-Root, nicht apps/api-edge)
    // und eine eigene SQLite-Datei, damit Testlaeufe nie die Dev-Datenbank anfassen.
    env: {
      NODE_CONFIG_DIR: join(__dirname, 'config'),
      SQLITE_PATH: join(__dirname, 'data', 'api-edge.test.sqlite'),
    },
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../coverage/apps/api-edge',
      provider: 'v8' as const,
    },
  },
}))
