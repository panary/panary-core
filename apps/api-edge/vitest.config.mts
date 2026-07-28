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
    // Alle Testdateien teilen sich EINE SQLite-Datei (siehe env.SQLITE_PATH).
    // Mehrere Suites treffen Aussagen ueber globalen Tabellen-Zustand — z.B.
    // prueft close-day-outbox-guard das Verhalten OHNE CONNECTED-Connection,
    // waehrend set-emergency-override genau so eine anlegen muss. Parallel
    // laufend sehen sie gegenseitig ihre Zeilen und flaken.
    //
    // Sauberer waere eine DB pro Datei; das geht in Vitest nicht per File
    // (env ist global). Bis dahin: deterministisch statt schnell — die Suite
    // liegt ohnehin im Sekundenbereich.
    fileParallelism: false,
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
