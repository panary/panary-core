import { join } from 'node:path'
import { defineConfig } from 'vitest/config'
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
      '@panary/shared/util-helpers': join(__dirname, '../../../shared/util-helpers/src/index.ts'),
      // Ab hier fuer Specs, die einen SERVICE laden (order.service.spec.ts) statt nur
      // eine util-Funktion. Ohne diese Aliase loest `@panary/shared/data-access` auf
      // eine reine `.d.ts` auf — zur Laufzeit ist `BaseService` dann `undefined` und
      // die Klasse stirbt beim Laden mit „Class extends value undefined".
      '@panary/shared/data-access': join(__dirname, '../../../shared/data-access/src/index.ts'),
      '@panary/locations/data-access': join(__dirname, '../../locations/data-access/src/index.ts'),
      '@panary/order-interactions/domain': join(__dirname, '../../order-interactions/domain/src/index.ts'),
      '@panary/util-error-handling': join(__dirname, '../../../shared/util-error-handling/src/index.ts'),
    },
  },
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
