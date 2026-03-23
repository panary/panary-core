// Knexfile für CLI-Befehle (pnpm db:migrate, pnpm db:create)
import path from 'path'
import { app } from './src/app'

const config = { ...app.get('sqlite') }

// Connection immer relativ zum Workspace-Root auflösen
// (CWD variiert: Root bei `nx serve`, apps/api-edge/ bei `knex` CLI)
const workspaceRoot = path.resolve(__dirname, '../..')
if (typeof config.connection === 'string') {
  config.connection = path.resolve(workspaceRoot, config.connection)
}

module.exports = config
