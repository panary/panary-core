// @panary-core/shared-backend
//
// Gemeinsame FeathersJS-Backend-Infrastructure für panary-core (SQLite/Edge)
// und panary-cloud (MongoDB). Wird von allen Domain-Backends (products,
// orders, users, ...) genutzt.
//
// Enthält (wird inkrementell befüllt, siehe Migration-Plan M1.2–M1.5):
//   - Hooks: authorize, multiTenancy, ensureTenantIsolation, secureByDefault,
//            allowApiKey, canonicalLog, parseJsonFields, stringifyJsonFields,
//            logError
//   - Validators: dataValidator, queryValidator (Ajv-Instanzen)
//   - Logger: Winston + Dev-Formatter
//   - Declarations: Application-Interface-Template

export { dataValidator, queryValidator } from './validators'
export type { Application, HookContext, NextFunction } from './declarations'
