import baseConfig from '../../../eslint.config.mjs'

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vite.config.{js,ts,mjs,mts}',
          ],
          // False-Positives: Nx loest @panary/users/domain auf den internen Subpackage-Namen
          // users-domain-internal auf (die Peer-Dep heisst @panary/users); vitest/@nx/vite sind
          // Test-Tooling aus vitest.config.mts, keine Runtime-Deps des publizierten Pakets.
          ignoredDependencies: ['users-domain-internal', '@panary/users', 'vitest', '@nx/vite'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
]
