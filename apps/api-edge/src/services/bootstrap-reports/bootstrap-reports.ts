// Edge-Bootstrap-Reports-Service.
//
// Diagnose-Persistenz pro Pairing-Vorgang. Externe Aufrufer sehen nur find/get
// (lesend). Schreibzugriff laeuft ausschliesslich ueber den
// `bootstrap-report.helper.ts` mit `provider: undefined` aus dem Bootstrap-
// Worker — analog zu sync-runs/audit-events.
//
// JSON-Felder (identity, preState, postState, restamp, syncRunIds,
// consistencyCheck) werden in SQLite als TEXT abgelegt und ueber den
// gemeinsamen `getJsonFieldHooks`-Helper transparent serialisiert/deserialisiert.
import { authenticate } from '@feathersjs/authentication'
import { Forbidden } from '@feathersjs/errors'
import { hooks as schemaHooks, resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import {
  type BootstrapReport,
  type BootstrapReportData,
  bootstrapReportDataSchema,
  bootstrapReportQuerySchema,
} from '@panary/cloud-connection/domain'
import {
  authorize,
  dataValidator,
  getJsonFieldHooks,
  multiTenancy,
  queryValidator,
} from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'

import type { Application, HookContext, NextFunction } from '../../declarations'

export const bootstrapReportsPath = 'bootstrap-reports'

const REPORT_JSON_FIELDS = [
  'identity',
  'preState',
  'postState',
  'restamp',
  'syncRunIds',
  'consistencyCheck',
]

const bootstrapReportDataValidator = getValidator(bootstrapReportDataSchema, dataValidator)
const bootstrapReportQueryValidator = getValidator(bootstrapReportQuerySchema, queryValidator)

const bootstrapReportResolver = resolve<BootstrapReport, HookContext>({})
const bootstrapReportExternalResolver = resolve<BootstrapReport, HookContext>({})

const bootstrapReportDataResolver = resolve<BootstrapReport, HookContext>({
  _id: async value => value || uuidv7(),
  createdAt: async (value, entity) =>
    value || (entity as { startedAt?: string })?.startedAt || new Date().toISOString(),
  updatedAt: async (value, entity) =>
    value || (entity as { startedAt?: string })?.startedAt || new Date().toISOString(),
})

const bootstrapReportQueryResolver = resolve<BootstrapReport, HookContext>({})

// Around-Hook: blockt externe Schreibzugriffe — Reports werden nur intern
// vom Bootstrap-Worker ueber den helper erzeugt/gepatcht.
const blockExternalWrites = async (context: HookContext, next: NextFunction) => {
  if (
    (context.method === 'create' || context.method === 'patch' || context.method === 'update') &&
    context.params.provider
  ) {
    throw new Forbidden('Bootstrap-Reports werden nur intern vom Bootstrap-Worker erzeugt')
  }
  await next()
}

export const bootstrapReports = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Model: any
  if (dbType === DatabaseType.SQLITE) Model = app.get('sqliteClient')

  const service = createServiceAdapter<BootstrapReport, BootstrapReportData>(app, {
    name: bootstrapReportsPath,
    Model,
    paginate,
    id: '_id',
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(bootstrapReportsPath, service as any, {
    methods: ['find', 'get', 'create', 'patch'],
    events: [],
  })

  const jsonHooks = getJsonFieldHooks(app, REPORT_JSON_FIELDS)

  app.service(bootstrapReportsPath).hooks({
    around: {
      all: [
        blockExternalWrites,
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false, allowGlobalData: true }),
        schemaHooks.resolveExternal(bootstrapReportExternalResolver),
        schemaHooks.resolveResult(bootstrapReportResolver),
      ],
    },
    before: {
      all: [
        schemaHooks.validateQuery(bootstrapReportQueryValidator),
        schemaHooks.resolveQuery(bootstrapReportQueryResolver),
      ],
      create: [
        schemaHooks.validateData(bootstrapReportDataValidator),
        schemaHooks.resolveData(bootstrapReportDataResolver),
        ...jsonHooks.before,
      ],
      patch: [
        ...jsonHooks.before,
      ],
    },
    after: {
      all: [...jsonHooks.after],
    },
    error: { all: [] },
  })
}
