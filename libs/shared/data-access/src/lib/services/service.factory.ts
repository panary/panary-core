import { Application, Params } from '@feathersjs/feathers'
import type { KnexAdapterOptions } from '@feathersjs/knex'
import { KnexService } from '@feathersjs/knex'
import type { MongoDBAdapterOptions } from '@feathersjs/mongodb'
import { MongoDBService } from '@feathersjs/mongodb'
import { DatabaseType } from '@panary-core/shared/common'

export interface ServiceOptions {
  name: string
  paginate?: KnexAdapterOptions['paginate']
  Model: unknown
  multi?: boolean | string[]
  id?: string
}

export function createServiceAdapter<T = unknown, D = Partial<T>, P extends Params = Params, Q = Partial<T>>(
  app: Application,
  options: ServiceOptions,
): KnexService<T, D, P, Q> | MongoDBService<T, D, P, Q> {
  // Fallback auf SQLite, falls nichts konfiguriert ist
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE
  const idField = options.id || '_id'

  if (dbType === DatabaseType.SQLITE) {
    // --- EDGE / CORE (SQLite via Knex) ---
    const knexOptions: KnexAdapterOptions = {
      Model: options.Model as KnexAdapterOptions['Model'],
      name: options.name,
      paginate: options.paginate,
      multi: options.multi,
      id: idField,
    }
    return new KnexService<T, D, P, Q>(knexOptions)
  }

  if (dbType === DatabaseType.MONGODB) {
    // --- CLOUD / ENTERPRISE (MongoDB via Mongoose) ---
    const mongoOptions: MongoDBAdapterOptions = {
      Model: options.Model as MongoDBAdapterOptions['Model'],
      paginate: options.paginate,
      multi: options.multi,
      id: idField,
    }
    return new MongoDBService<T, D, P, Q>(mongoOptions)
  }

  throw new Error(`Unsupported Database Type: ${dbType}`)
}
