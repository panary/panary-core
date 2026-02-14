// For more information about this file see https://dove.feathersjs.com/guides/cli/databases.html
import type { Knex } from 'knex'
import knex from 'knex'
import type { Application } from './declarations'

declare module './declarations' {
  interface Configuration {
    sqliteClient: Knex
  }
}

export const sqlite = (app: Application) => {
  const config = app.get('sqlite')

  if (!config) {
    console.warn('WARNING: No SQLite configuration found in app config!')
    console.warn('   Skipping Database initialization.')
    return // Einfach abbrechen, statt abzustürzen
  }

  const db = knex(config!)

  app.set('sqliteClient', db)
}
