// Edge-Store für den lückenlosen Fiskal-Zähler (KassenSichV-Vorgangsnummer).
//
// Umgebungs-lokal und NICHT gesynct: der Edge ist autoritativ für die Locations,
// die er fiskalisch signiert. Die Vergabe läuft über einen In-Process-Mutex —
// der Edge ist single-process, damit ist die Sequenz lückenlos und monoton.
// Persistenz ausschließlich über die Feathers-Adapter-API (kein Knex-Raw-Write).
import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { Mutex } from 'async-mutex'

import { authorize, multiTenancy, dataValidator, queryValidator } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  type FiscalCounter,
  fiscalCounterId,
  fiscalCounterPatchSchema,
  fiscalCounterQuerySchema,
  fiscalCounterSchema,
  nextFiscalCounterValue,
} from '@panary/tse/domain'

import type { Application, HookContext } from '../../declarations'

export const fiscalCountersPath = 'fiscal-counters'

const fiscalCounterDataValidator = getValidator(fiscalCounterSchema, dataValidator)
const fiscalCounterPatchValidator = getValidator(fiscalCounterPatchSchema, dataValidator)
const fiscalCounterQueryValidator = getValidator(fiscalCounterQuerySchema, queryValidator)

const fiscalCounterResolver = resolve<FiscalCounter, HookContext>({})
const fiscalCounterExternalResolver = resolve<FiscalCounter, HookContext>({})

const fiscalCounterDataResolver = resolve<FiscalCounter, HookContext>({
  createdAt: async () => new Date().toISOString(),
  updatedAt: async () => new Date().toISOString(),
})

const fiscalCounterPatchResolver = resolve<FiscalCounter, HookContext>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  locationId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
})

const fiscalCounterQueryResolver = resolve<FiscalCounter, HookContext>({})

// Serialisiert die Zähler-Vergabe prozessweit (Edge = single-process) → lückenlos.
const allocationMutex = new Mutex()

/**
 * Vergibt den nächsten lückenlosen Fiskal-Zählerwert für (tenantId, locationId)
 * und persistiert ihn atomar, BEVOR der nächste Wert vergeben werden kann.
 * Interner Aufruf (`provider: undefined`) — umgeht Auth/Tenant-Filter.
 */
export async function allocateFiscalCounter(
  app: Application,
  tenantId: string,
  locationId: string,
): Promise<number> {
  return allocationMutex.runExclusive(async () => {
    const id = fiscalCounterId(tenantId, locationId)
    const service = app.service(fiscalCountersPath)

    let current: FiscalCounter | undefined
    try {
      current = (await service.get(id, { provider: undefined })) as FiscalCounter
    } catch {
      current = undefined
    }

    const next = nextFiscalCounterValue(current?.lastValue)
    if (current) {
      await service.patch(id, { lastValue: next }, { provider: undefined })
    } else {
      await service.create({ _id: id, tenantId, locationId, lastValue: next }, { provider: undefined })
    }
    return next
  })
}

export const fiscalCounters = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE
  let Model: any
  if (dbType === DatabaseType.SQLITE) Model = app.get('sqliteClient')

  const service = createServiceAdapter<FiscalCounter>(app, {
    name: fiscalCountersPath,
    Model,
    paginate,
    id: '_id',
    multi: [],
  })

  app.use(fiscalCountersPath, service as any, {
    methods: ['find', 'get', 'create', 'patch', 'remove'],
    events: [],
  })

  // Interner Infrastruktur-Service: extern nicht erreichbar (kein
  // RolePermissions-Eintrag → authorize() liefert 403 für externe Caller).
  // Alle Zugriffe laufen intern über allocateFiscalCounter (provider: undefined).
  app.service(fiscalCountersPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false, allowGlobalData: true }),
        schemaHooks.resolveExternal(fiscalCounterExternalResolver),
        schemaHooks.resolveResult(fiscalCounterResolver),
      ],
    },
    before: {
      all: [
        schemaHooks.validateQuery(fiscalCounterQueryValidator),
        schemaHooks.resolveQuery(fiscalCounterQueryResolver),
      ],
      create: [
        schemaHooks.validateData(fiscalCounterDataValidator),
        schemaHooks.resolveData(fiscalCounterDataResolver),
      ],
      patch: [
        schemaHooks.validateData(fiscalCounterPatchValidator),
        schemaHooks.resolveData(fiscalCounterPatchResolver),
      ],
    },
    error: { all: [] },
  })
}
