// Abschreibungen am Edge (panary/panary-core#635).
//
// Der POS erfasst Abschreibungen über den Abschreibungs-Dialog; der Edge speichert sie, auch
// offline, und der Outbox-Recorder pusht sie als Transaktion in die Cloud
// (`SyncableTransactionService.WRITE_OFFS`). Die Lagerbuchung passiert genau einmal in der Cloud
// beim Sync-Eingang (`writeOffStockUpdate`, panary/panary-cloud#1205) — der Edge bucht keinen
// Bestand.
//
// - Methoden: find, get, create. Append-only: Eine Korrektur ist eine neue Abschreibung, wie bei
//   den Lagerbewegungen in der Cloud. patch/remove sind nicht registriert.
// - `userId` kommt bei Geräte-Sessions aus dem Bediener-Token (`attributedOperatorId`, ADR 0053),
//   nicht aus dem Body (`pos_current_user` wäre manipulierbar).
import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'

import { writeOffDataSchema, writeOffQuerySchema, writeOffSchema } from '@panary/write-offs/domain'
import { authorize, ensureIndexes, multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'

import { validateData } from '../../hooks/validate-data.hook'
import { attributedOperatorId } from '../../utils/pos-operator-attribution'
import type { Application, HookContext } from '../../declarations'
import type { WriteOff, WriteOffService } from './write-offs.class'
import {
  writeOffDataResolver,
  writeOffDataValidator,
  writeOffExternalResolver,
  writeOffQueryResolver,
  writeOffQueryValidator,
  writeOffResolver,
} from './write-offs.schema'

export const writeOffsPath = 'write-offs'
export const writeOffsMethods = ['find', 'get', 'create'] as const

export * from './write-offs.schema'

// Vor `validateData`: Das Schema verlangt `userId` als uuid, der belegte Wert muss davor stehen.
const attributeOperator = async (context: HookContext) => {
  const data = context.data as { userId?: string } | undefined
  if (context.params.provider && data && !Array.isArray(data)) {
    data.userId = attributedOperatorId(context.params, data.userId, { service: writeOffsPath, field: 'userId' })
  }
  return context
}

export const writeOffs = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Model: any
  if (dbType === DatabaseType.SQLITE) Model = app.get('sqliteClient')

  const service = createServiceAdapter<WriteOff>(app, {
    name: writeOffsPath,
    Model,
    paginate,
    id: '_id',
    multi: [],
  }) as unknown as WriteOffService

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      writeOffsPath,
      [
        { name: 'idx_write-offs_tenant_location_created', columns: ['tenantId', 'locationId', 'createdAt'] },
        { name: 'idx_write-offs_tenant_updated', columns: ['tenantId', 'updatedAt'] },
      ],
      service,
    )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(writeOffsPath, service as any, {
    methods: writeOffsMethods,
    events: [],
    docs: {
      description: 'Abschreibungen (append-only, Edge→Cloud-Push)',
      schemas: { writeOff: writeOffSchema, writeOffData: writeOffDataSchema, writeOffQuery: writeOffQuerySchema },
    },
  })

  app.service(writeOffsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),
        schemaHooks.resolveExternal(writeOffExternalResolver),
        schemaHooks.resolveResult(writeOffResolver),
      ],
    },
    before: {
      all: [schemaHooks.validateQuery(writeOffQueryValidator), schemaHooks.resolveQuery(writeOffQueryResolver)],
      create: [attributeOperator, validateData(writeOffDataValidator), schemaHooks.resolveData(writeOffDataResolver)],
    },
  })
}
