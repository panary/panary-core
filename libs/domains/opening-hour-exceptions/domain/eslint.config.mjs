import baseConfig from '../../../../eslint.config.mjs'

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      // 'off' wie in den uebrigen 36 Domain-Libs: Dieses Manifest ist
      // `<name>-internal`, `private: true` und wird nie publiziert — das
      // publizierte @panary/<domain> liegt eine Ebene hoeher und pflegt seine
      // peerDependencies selbst. Auf 'error' meldet die Regel Build-Zeit-Importe
      // (vitest, @nx/vite) als fehlende Laufzeit-Deps, und ein `--fix` schreibt
      // sie hinein — in panary-cloud (PR #53) zog das nx als echte Dependency
      // ins Lockfile und faerbte jeden PR rot.
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
