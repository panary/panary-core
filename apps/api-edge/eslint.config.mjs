import baseConfig from '../../eslint.config.mjs'

export default [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    rules: {
      // Feathers-Scaffolding deklariert leere Params-Interfaces mit einem Extends
      // (z.B. `interface ApikeyParams extends KnexAdapterParams<ApikeyQuery> {}`)
      // als benannte Erweiterungspunkte — Single-Extends-Fälle deshalb erlauben.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
      '@typescript-eslint/no-empty-interface': ['error', { allowSingleExtends: true }],
    },
  },
]
