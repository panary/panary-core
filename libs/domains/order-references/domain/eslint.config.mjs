import baseConfig from '../../../../eslint.config.mjs'

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      // 'off' wie in allen 33 anderen Domain-Libs: Diese package.json ist eine
      // reine Nx-Huelle. Die echten Abhaengigkeiten stehen als peerDependencies
      // im publizierten Parent-Manifest (libs/domains/order-references/package.json).
      // Die Regel prueft hier die falsche Datei.
      '@nx/dependency-checks': [
        'off',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vite.config.{js,ts,mjs,mts}',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
]
