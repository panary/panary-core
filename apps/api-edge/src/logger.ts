// For more information about this file see https://dove.feathersjs.com/guides/cli/logging.html
import { createLogger, format, transports } from 'winston'
import type { Application } from './declarations'

// Configure the Winston logger. For the complete documentation see https://github.com/winstonjs/winston
export const logger = createLogger({
  // Default level - wird später aus Config überschrieben
  level: 'info',
  format: format.combine(format.splat(), format.simple()),
  transports: [new transports.Console()]
})

// Funktion um Logger Level aus Config zu laden
export const configureLoggerLevel = (app: Application) => {
  const logLevel = app.get('logLevel')

  if (logLevel) {
    logger.level = logLevel
    logger.info(`Logger level set to: ${logLevel}`)
  }
}
