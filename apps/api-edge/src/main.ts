import './bootstrap'
import { app } from './app'
import { logger } from './logger'

const port = app.get('port') || 3030
const host = app.get('host') || 'localhost'

process.on('unhandledRejection', (reason, p) => logger.error('Unhandled Rejection at: Promise ', p, reason))

app.listen(port).then(() => {
  logger.info(`Feathers app listening on http://${host}:${port}`)
})
