import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { authorize, ensureIndexes, getJsonFieldHooks, multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  cashSessionDataSchema,
  cashSessionPatchSchema,
  cashSessionQuerySchema,
  cashSessionSchema,
  type CashSession,
} from '@panary/businessdays/domain'

import type { Application } from '../../declarations'
import { recomputeCashSessionTotals } from '../../hooks/recompute-cash-session.hook'
import { restrictCashSessionToOwner } from '../../hooks/restrict-cash-session-to-owner.hook'
import type { CashSessionService } from './cash-sessions.class'
import {
  cashSessionDataResolver,
  cashSessionDataValidator,
  cashSessionExternalResolver,
  cashSessionPatchResolver,
  cashSessionPatchValidator,
  cashSessionQueryResolver,
  cashSessionQueryValidator,
  cashSessionResolver,
} from './cash-sessions.schema'

export const cashSessionsPath = 'cash-sessions'
export const cashSessionsMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

// denominationCounts ist ein JSON-Objekt (TEXT-Spalte in SQLite) → serialisieren.
const CASH_SESSION_JSON_FIELDS = ['denominationCounts']

export * from './cash-sessions.schema'

/**
 * Kassen-Sessions (Multi-Kassen-Tagesabschluss) — EDGE-nativ + bidirektional
 * gesynct. Anders als `discounts` (Cloud-managed, am Edge read-only) ist die
 * Kasse am Edge SCHREIBBAR: Bargeld wird physisch am POS gehandhabt, der
 * Kassierer eröffnet/zählt/schließt seine Lade offline (kein cloudManaged-Hook).
 *
 * Lifecycle über Standard-CRUD: create=eröffnen, patch=zählen/schließen. Der
 * Edge berechnet nur `countedClosingFloatCents` (Stückelungen); Soll/Varianz
 * bleiben cloud-autoritativ (siehe recompute-cash-session.hook).
 *
 * RBAC: AppResource.CASH_SESSIONS — DEVICE_POS READ+CREATE+UPDATE (Self-Scope
 * via restrictCashSessionToOwner).
 */
export const cashSessions = (app: Application) => {
  const paginate = app.get('paginate')

  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any
  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  }

  const service = createServiceAdapter<CashSession>(app, {
    name: cashSessionsPath,
    Model,
    paginate,
    id: '_id',
    multi: [],
  }) as unknown as CashSessionService

  ;(service as any).setup = async (app: Application) =>
    ensureIndexes(
      app,
      cashSessionsPath,
      [
        { name: 'idx_cash-sessions_tenant', columns: ['tenantId'] },
        { name: 'idx_cash-sessions_tenant_businessday', columns: ['tenantId', 'businessDayId'] },
        { name: 'idx_cash-sessions_tenant_businessday_status', columns: ['tenantId', 'businessDayId', 'status'] },
        { name: 'idx_cash-sessions_openedby', columns: ['openedBy'] },
      ],
      service,
    )

  app.use(cashSessionsPath, service as any, {
    methods: cashSessionsMethods,
    events: [],
    docs: {
      description: 'Kassen-Sessions (Multi-Kassen-Tagesabschluss, edge-nativ + gesynct)',
      schemas: {
        cashSession: cashSessionSchema,
        cashSessionData: cashSessionDataSchema,
        cashSessionPatch: cashSessionPatchSchema,
        cashSessionQuery: cashSessionQuerySchema,
      },
    },
  })

  const jsonHooks = getJsonFieldHooks(app, CASH_SESSION_JSON_FIELDS)

  app.service(cashSessionsPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: true, allowGlobalData: false }),
        schemaHooks.resolveExternal(cashSessionExternalResolver),
        schemaHooks.resolveResult(cashSessionResolver),
      ],
    },
    before: {
      all: [schemaHooks.validateQuery(cashSessionQueryValidator), schemaHooks.resolveQuery(cashSessionQueryResolver)],
      // Self-Scope: STAFF/POS nur eigene Laden.
      find: [restrictCashSessionToOwner],
      get: [restrictCashSessionToOwner],
      create: [
        schemaHooks.validateData(cashSessionDataValidator),
        schemaHooks.resolveData(cashSessionDataResolver),
        // recompute VOR jsonHooks (liest denominationCounts noch als Objekt).
        recomputeCashSessionTotals,
        ...jsonHooks.before,
      ],
      patch: [
        restrictCashSessionToOwner,
        schemaHooks.validateData(cashSessionPatchValidator),
        schemaHooks.resolveData(cashSessionPatchResolver),
        recomputeCashSessionTotals,
        ...jsonHooks.before,
      ],
      remove: [restrictCashSessionToOwner],
    },
    after: {
      all: [...jsonHooks.after],
    },
    error: {
      all: [],
    },
  })
}
