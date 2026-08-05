/// <reference types='vitest' />
import { join } from 'node:path'
import { defineConfig } from 'vite'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../../../node_modules/.vite/libs/domains/orders/data-access',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  resolve: {
    // Die ng-packagr-`paths` in tsconfig.lib.json zeigen auf dist-`.d.ts`
    // (Build-Typ-Auflösung) — für die Vitest-LAUFZEIT auf die TS-Quellen umbiegen.
    alias: {
      '@panary/orders/domain': join(__dirname, '../domain/src/index.ts'),
      '@panary/shared-common': join(__dirname, '../../../shared/common/src/index.ts'),
    },
  },
  // Uncomment this if you are using workers.
  // worker: {
  //   plugins: () => [ nxViteTsPaths() ],
  // },
  test: {
    name: 'orders-data-access',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/domains/orders/data-access',
      provider: 'v8' as const,
    },
  },
}))
