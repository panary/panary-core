// Knexfile für CLI-Befehle (pnpm db:migrate, pnpm db:create)
import path from 'path'
import { app } from './src/app'

const config = { ...app.get('sqlite') }

// sqlite.ts hat config.connection bereits via process.cwd() aufgelöst.
// Da knex --knexfile das cwd zu apps/api-edge/ verschiebt, ist diese URL falsch.
// Wir leiten den relativen Pfad zurück ab und lösen ihn vom echten Workspace-Root auf.
const workspaceRoot = path.resolve(__dirname, '../..')
if (typeof config.connection === 'string') {
  const relative = path.isAbsolute(config.connection)
    ? path.relative(process.cwd(), config.connection)
    : config.connection
  config.connection = path.resolve(workspaceRoot, relative)
}

module.exports = config
