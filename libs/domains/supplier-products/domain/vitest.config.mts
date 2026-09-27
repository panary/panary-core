import { join } from 'node:path'
import type { Plugin } from 'vite'
import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'

/**
 * Biegt `@panary/allergens/domain` fuer die Vitest-LAUFZEIT auf die TS-Quelle um.
 *
 * `tsconfig.lib.json` mappt den Import auf `allergens/domain/dist/index.d.ts` — fuer die
 * Build-Typaufloesung so gewollt (CLAUDE.md §2.1). `nxViteTsPaths()` liest genau diese
 * `paths`; sobald das dist existiert, laedt Vitest darueber eine reine TYPdatei ohne Code.
 * `allergenSchema` ist dann `undefined`, `Type.Array(undefined)` prueft nichts, und die
 * Specs bleiben trotzdem gruen (panary/panary-core#403). Die Ablehnungs-Tests in der
 * Schema-Spec werden ohne diesen Resolver rot.
 *
 * Ein Resolver statt `resolve.alias`, weil er exakt vergleicht; Begruendung, Config-Datei
 * und der Zwei-Laeufe-Test (erst `typecheck`, dann `test`) stehen in
 * `libs/domains/apikeys/domain/vitest.config.mts`.
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
  cacheDir: '../../../../node_modules/.vite/libs/domains/supplier-products/domain',
  // Reihenfolge traegt: `domainSourcesForVitest` MUSS vor `nxViteTsPaths()` stehen.
  plugins: [domainSourcesForVitest(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'supplier-products-domain',
    watch: false,
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/domains/supplier-products/domain',
      provider: 'v8' as const,
    },
  },
}))
