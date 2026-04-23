// @panary-core/shared-backend
//
// Gemeinsame FeathersJS-Backend-Infrastructure für panary-core (SQLite/Edge)
// und panary-cloud (MongoDB). Wird von allen Domain-Backends (products,
// orders, users, ...) genutzt.

// --- Declarations ---
export type { Application, HookContext, NextFunction } from './declarations'

// --- Validators ---
export { dataValidator, queryValidator } from './validators'

// --- Logger ---
export { logger, configureLoggerLevel } from './logger'

// --- Hooks ---
export { allowApiKey } from './hooks/allow-apikey.hook'
export { authorize } from './hooks/authorize.hook'
export { canonicalLog } from './hooks/canonical-log.hook'
export { ensureTenantIsolation } from './hooks/ensure-tenant-isolation.hook'
export { logError } from './hooks/log-error'
export { multiTenancy } from './hooks/multi-tenancy.hook'
export type { MultiTenancyOptions } from './hooks/multi-tenancy.hook'
export { parseJsonFields } from './hooks/parse-json-fields.hook'
export { restrictToCloud } from './hooks/restrict-to-cloud.hook'
export { secureByDefault } from './hooks/secure-by-default.hook'
export { stringifyJsonFields } from './hooks/stringify-json-fields.hook'

// --- Util DB ---
export { getJsonFieldHooks } from './util-db/get-json-field-hooks'
