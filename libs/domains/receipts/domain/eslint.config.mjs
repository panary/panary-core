import baseConfig from '../../../../eslint.config.mjs'

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      // 'off' wie in den uebrigen 36 Domain-Libs — siehe
      // libs/domains/opening-hour-exceptions/domain/eslint.config.mjs fuer die
      // Begruendung (privates -internal-Manifest, `--fix` schreibt Build-Tools
      // in die Laufzeit-Deps).
      '@nx/dependency-checks': [
        'off',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vitest.config.{js,ts,mjs,mts}',
          ],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
]
