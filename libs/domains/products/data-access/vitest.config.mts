import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'

const workspaceRoot = join(__dirname, '../../../..')

// Die ng-packagr-`paths` in tsconfig.lib.json zeigen auf dist-`.d.ts`
// (Build-Typ-Aufloesung) — fuer die Vitest-LAUFZEIT alle @panary/*-Importe
// auf die TS-Quellen aus tsconfig.base.json umbiegen. Generisch statt
// handgepflegter Liste, weil ProductService transitiv viele Domain-Libs zieht.
const basePaths = (
  JSON.parse(readFileSync(join(workspaceRoot, 'tsconfig.base.json'), 'utf-8')) as {
    compilerOptions: { paths: Record<string, string[]> }
  }
).compilerOptions.paths

const panarySourceAliases = Object.fromEntries(
  Object.entries(basePaths)
    .filter(([importPath]) => importPath.startsWith('@panary/'))
    .map(([importPath, [target]]) => [importPath, join(workspaceRoot, target)]),
)

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../../node_modules/.vite/libs/domains/products/data-access',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  resolve: {
    alias: panarySourceAliases,
  },
  test: {
    name: 'products-data-access',
    watch: false,
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/domains/products/data-access',
      provider: 'v8' as const,
    },
  },
}))
