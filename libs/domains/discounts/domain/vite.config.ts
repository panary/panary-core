/// <reference types='vitest' />
import { defineConfig } from 'vite'
import { nxViteTsPaths } from '@nx/vite/plugins/nx-tsconfig-paths.plugin'
import { nxCopyAssetsPlugin } from '@nx/vite/plugins/nx-copy-assets.plugin'

export default defineConfig(() => ({
  root: import.meta.dirname,
  cacheDir: '../../../../node_modules/.vite/libs/domains/discounts/domain',
  plugins: [nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
  test: {
    name: 'discounts-domain',
    watch: false,
    globals: true,
    environment: 'node',
    passWithNoTests: true,
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    coverage: {
      reportsDirectory: '../../../../coverage/libs/domains/discounts/domain',
      provider: 'v8' as const,
    },
  },
}))
