import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'

const workspaceRoot = join(__dirname, '../../../..')

/**
 * Biegt JEDEN `@panary/*`-Import fuer die Vitest-LAUFZEIT auf die TS-Quelle aus
 * `tsconfig.base.json` um.
 *
 * Die ng-packagr-`paths` in `tsconfig.lib.json` zeigen auf dist-`.d.ts` (Build-Typ-
 * Aufloesung, CLAUDE.md §2.1). `nxViteTsPaths()` liest genau diese `paths`; sobald die
 * dists gebaut sind, laedt Vitest darueber reine TYPdateien ohne Code. Laedt eine Spec
 * einen SERVICE (order.service.spec.ts) statt nur einer util-Funktion, ist `BaseService`
 * aus `@panary/shared/data-access` dann `undefined` und die Klasse stirbt beim Laden mit
 * „Class extends value undefined" (#225).
 *
 * Generisch statt handgepflegter Liste: Die frueheren sieben Aliase deckten die direkten
 * Importe ab, aber nicht, was deren Quellen transitiv ziehen — sieben weitere Schluessel
 * (`@panary/users/*`, `@panary/user-preferences/*`, `@panary/locations/domain`,
 * `@panary/shared/data-access-config`, `@panary/shared/ui-notifications`) kamen still als
 * `.d.ts` herein, 85/85 Tests blieben gruen (panary/panary-core#398, #403).
 *
 * Ein Resolver statt `resolve.alias`, weil er exakt vergleicht: Der Alias faengt auch
 * Unterpfade (`@panary/shared/data-access` → `…/server`, ENOTDIR — #402). Er MUSS vor
 * `nxViteTsPaths()` stehen; innerhalb von `enforce: 'pre'` gilt die Array-Reihenfolge.
 * Config-Datei und Zwei-Laeufe-Test (erst `typecheck`, dann `test`): siehe
 * `libs/domains/apikeys/domain/vitest.config.mts`.
 */
const panarySourcesForVitest = (): Plugin => {
  const basePaths = (
    JSON.parse(readFileSync(join(workspaceRoot, 'tsconfig.base.json'), 'utf-8')) as {
      compilerOptions: { paths: Record<string, string[]> }
    }
  ).compilerOptions.paths
  const sources: Record<string, string> = Object.fromEntries(
    Object.entries(basePaths)
      .filter(([importPath]) => importPath.startsWith('@panary/'))
      .map(([importPath, [target]]) => [importPath, join(workspaceRoot, target)]),
  )
  return {
    name: 'panary-sources-for-vitest',
    enforce: 'pre',
    resolveId: (id: string) => sources[id] ?? null,
  }
}

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../../node_modules/.vite/libs/domains/orders/data-access',
  // Reihenfolge traegt: `panarySourcesForVitest` MUSS vor `nxViteTsPaths()` stehen.
  plugins: [panarySourcesForVitest(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'orders-data-access',
    watch: false,
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/domains/orders/data-access',
      provider: 'v8' as const,
    },
  },
}))
