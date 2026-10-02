import { defineConfig } from 'vitest/config'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'
import { panaryVitestPlugins } from '../../../../tools/vitest/panary-vitest'

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../../node_modules/.vite/libs/domains/product-groups/data-access',
  // Reihenfolge traegt: Resolver + Waechter MUESSEN vor `nxViteTsPaths()` stehen (tools/vitest/panary-vitest.ts).
  plugins: [...panaryVitestPlugins(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'product-groups-data-access',
    watch: false,
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/domains/product-groups/data-access',
      provider: 'v8' as const,
    },
  },
}))
