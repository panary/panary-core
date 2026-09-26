import { join } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'

/**
 * Biegt `@panary/allergens/domain` für die Vitest-LAUFZEIT auf die TS-Quelle um.
 *
 * `tsconfig.lib.json` mappt den Import für den Build auf die dist-`.d.ts` (CLAUDE.md §2.1, sonst
 * TS6059). Sobald `allergens/domain/dist` existiert, löst `nxViteTsPaths()` über genau diesen Pfad
 * auf — an #393 lieferte der Import dann nicht die allergens-Exporte, sondern die dieser Lib
 * selbst. `allergenSchema`/`additiveSchema` waren `undefined`, `Type.Array(undefined)` prüft
 * nichts, und alle drei Enum-Ablehnungen der Spec kippten: im `nx affected`-Lauf 3 von 26 rot,
 * im Einzellauf ohne dist grün.
 *
 * Resolver VOR `nxViteTsPaths()` und in DIESER Datei, nicht in `vite.config.ts` — Begründung und
 * Gegenproben stehen in `libs/domains/apikeys/domain/vitest.config.mts` (#334).
 */
const domainSourcesForVitest = (): Plugin => {
  const sources: Record<string, string> = {
    '@panary/allergens/domain': join(__dirname, '../../allergens/domain/src/index.ts'),
  }
  return {
    name: 'panary-domain-sources-for-vitest',
    enforce: 'pre',
    resolveId: (id: string) => sources[id] ?? null,
  }
}

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../../node_modules/.vite/libs/domains/products/domain',
  // Reihenfolge trägt: `domainSourcesForVitest` MUSS vor `nxViteTsPaths()` stehen.
  plugins: [domainSourcesForVitest(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'domain',
    watch: false,
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/domains/products/domain',
      provider: 'v8' as const,
    },
  },
}))
