// For more information about this file see https://dove.feathersjs.com/guides/cli/log-error.html
import type { HookContext, NextFunction } from '../declarations'
import { logger } from '@panary-core/shared-backend'

/**
 * Fallback-Error-Logging für interne Aufrufe (ohne Provider).
 *
 * Externe Requests werden vollständig durch canonicalLog erfasst.
 * Dieser Hook fängt nur noch Fehler bei internen Service-Aufrufen ab,
 * die canonicalLog überspringt (kein provider → kein Wide Event).
 */
export const logError = async (context: HookContext, next: NextFunction) => {
  try {
    await next()
  } catch (error: any) {
    // Externe Requests loggt canonicalLog — hier nur interne Aufrufe
    if (!context.params.provider) {
      if (!error.code || error.code >= 500) {
        logger.error({
          message: 'Internal service error',
          service: context.path,
          method: context.method,
          errorName: error.name,
          errorMessage: error.message,
          errorStack: error.stack,
        })
      }
    }

    throw error
  }
}
