import { join } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'

/**
 * Biegt den Cross-Lib-Import `@panary/users/domain` fuer die Vitest-LAUFZEIT auf
 * die TS-Quelle um.
 *
 * `tsconfig.lib.json` mappt ihn auf die dist-`.d.ts` — fuer die Build-Typaufloesung
 * so gewollt (CLAUDE.md §2.1, sonst TS6059). `nxViteTsPaths()` liest genau diese
 * `paths`, also laedt Vitest darueber eine reine TYPdatei ohne Code: `UserSystemRole`
 * ist zur Laufzeit `undefined` und `apikey.schema.ts` stirbt beim Laden mit
 * „Cannot read properties of undefined (reading 'DEVICE_POS')".
 *
 * 🚨 **`resolve.alias` reicht nicht.** `nxViteTsPaths()` laeuft mit `enforce: 'pre'`,
 * findet den Pfad und gibt ihn zurueck, bevor Vites Alias-Aufloesung greift — eine
 * Gegenprobe mit absichtlich falschem Alias-Ziel aenderte die Fehlermeldung nicht.
 * Deshalb ein eigener Resolver VOR `nxViteTsPaths()`: Innerhalb von `enforce: 'pre'`
 * gilt die Reihenfolge des Arrays.
 *
 * 🚨 **Und er gehoert in DIESE Datei, nicht in `vite.config.ts`.** Vitest sucht seine
 * Config in der Reihenfolge `vitest.config` vor `vite.config`; solange hier eine
 * `vitest.config.mts` liegt, wird `vite.config.ts` fuer Tests nie geladen. Ein Fix
 * dort ist wirkungslos, ohne dass irgendetwas es meldet (an panary/panary-core#334
 * genau so passiert).
 *
 * 🚨 **Der Fehler taucht erst auf, wenn `users/domain/dist` existiert.** Das Plugin
 * prueft `existsSync`; ohne dist faellt es auf `tsconfig.base.json` und damit auf die
 * Quelle zurueck. Ein frisches `nx test apikeys-domain` ist deshalb gruen, derselbe
 * Test im `nx affected`-Lauf (der die dists baut) rot — lokal unzuverlaessig, in der
 * CI zuverlaessig. Vor dem PR daher in dieser Reihenfolge fahren:
 * `nx run-many -t typecheck,test --projects=apikeys-domain --skip-nx-cache`.
 */
const domainSourcesForVitest = (): Plugin => {
  const sources: Record<string, string> = {
    '@panary/users/domain': join(__dirname, '../../users/domain/src/index.ts'),
    '@panary/shared-common': join(__dirname, '../../../shared/common/src/index.ts'),
  }
  return {
    name: 'panary-domain-sources-for-vitest',
    enforce: 'pre',
    resolveId: (id: string) => sources[id] ?? null,
  }
}

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../../node_modules/.vite/libs/domains/apikeys/domain',
  // Reihenfolge traegt: `domainSourcesForVitest` MUSS vor `nxViteTsPaths()` stehen.
  plugins: [domainSourcesForVitest(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'apikeys-domain',
    watch: false,
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/domains/apikeys/domain',
      provider: 'v8' as const,
    },
  },
}))
