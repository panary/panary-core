// For more information about this file see https://dove.feathersjs.com/guides/cli/log-error.html
import type { HookContext, NextFunction } from '../declarations'
import { logger } from '../logger'

export const logError = async (context: HookContext, next: NextFunction) => {
  try {
    await next()
  } catch (error: any) {
    // Erwartete Client-Fehler (4xx) nur als Einzeiler loggen
    if (error.code && error.code >= 400 && error.code < 500) {
      logger.info(`${error.code} ${error.name}: ${error.message} [${context.path}/${context.method}]`)
      if (error.data) {
        logger.debug(`  Validation details: ${JSON.stringify(error.data)}`)
      }
      if (context.data && error.code === 400) {
        logger.debug(`  Request data: ${JSON.stringify(context.data)}`)
      }
    } else {
      logger.error(error.stack)

      if (error.data) {
        logger.error('Data: %O', error.data)
      }
    }

    throw error
  }
}
