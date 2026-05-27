import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { BadRequest, Forbidden } from '@feathersjs/errors'
import { authorize, ensureIndexes, getJsonFieldHooks, logger, multiTenancy } from '@panary/shared-backend'
import { createServiceAdapter } from '@panary/shared/data-access/server'
import { DatabaseType } from '@panary/shared-common'
import {
  cashSessionDataSchema,
  cashSessionPatchSchema,
  cashSessionQuerySchema,
  cashSessionSchema,
  type CashSession,
  type CashSessionData,
} from '@panary/businessdays/domain'

import type { Application, HookContext } from '../../declarations'
import { recomputeCashSessionTotals } from '../../hooks/recompute-cash-session.hook'
import {
  PRIVILEGED_CASH_SESSION_ROLES,
  restrictCashSessionToOwner,
} from '../../hooks/restrict-cash-session-to-owner.hook'
import type { CashSessionAuthorizedOpenData, CashSessionService } from './cash-sessions.class'
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
export const cashSessionsMethods = ['find', 'get', 'create', 'patch', 'remove', 'openAuthorized'] as const

// denominationCounts ist ein JSON-Objekt (TEXT-Spalte in SQLite) → serialisieren.
const CASH_SESSION_JSON_FIELDS = ['denominationCounts']

export * from './cash-sessions.schema'

const isFromSync = (context: HookContext): boolean =>
  Boolean((context.params as { fromSync?: boolean }).fromSync)

/**
 * Härtung des Standard-`create`-Pfads: Eine Kasse darf extern NICHT mehr von
 * einem nicht-privilegierten Mitarbeiter (STAFF/DEVICE_POS) direkt angelegt
 * werden — die Eröffnung muss autorisiert sein (POS: `openAuthorized` mit
 * Manager-PIN; Cloud: privilegierte Rolle). Durchgelassen:
 *   - interne Aufrufe (kein provider): Auto-Open-Guard, openAuthorized-Create
 *   - Sync-Apply (fromSync), auch wenn provider gesetzt ist
 *   - privilegierte Rollen (Manager/Inhaber/Techniker) — sie SIND die Autorisierung
 */
const requireAuthorizedCreate = async (context: HookContext): Promise<HookContext> => {
  if (!context.params.provider) return context
  if (isFromSync(context)) return context
  const role = (context.params.user as { role?: string } | undefined)?.role
  if (role && PRIVILEGED_CASH_SESSION_ROLES.has(role)) return context
  throw new Forbidden(
    'Die Kassen-Eröffnung muss von einem berechtigten Mitarbeiter (Manager/Inhaber) autorisiert werden.',
    { code: 'CASH_SESSION_AUTH_REQUIRED' },
  )
}

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

  // Custom-Method: manager-autorisierte Kassen-Eröffnung am POS. Verifiziert den
  // PIN des berechtigten Mitarbeiters server-seitig (offline-fähig, Edge-lokal),
  // prüft dessen Rolle und legt die Kasse intern an (openedBy = Kassierer).
  service.openAuthorized = async (data: CashSessionAuthorizedOpenData, params: any = {}) => {
    const { businessDayId, openedBy, openingFloatCents, label, authorizedByUserId, pin } = data
    if (!authorizedByUserId || !pin) {
      throw new BadRequest('authorizedByUserId und pin sind erforderlich')
    }
    if (!businessDayId || !openedBy) {
      throw new BadRequest('businessDayId und openedBy sind erforderlich')
    }

    // 1. PIN des autorisierenden Mitarbeiters prüfen (wirft NotAuthenticated bei falschem PIN).
    let manager: { _id?: string; role?: string }
    try {
      manager = (await app.service('users').verifyPin(
        { userId: authorizedByUserId, pin },
        { provider: undefined },
      )) as { _id?: string; role?: string }
    } catch {
      // PIN NIE loggen (logging.md). Nur das Ereignis.
      logger.warn({
        message: 'cash_session.authorize_failed',
        event: 'cash_session.authorize_failed',
        reason: 'pin',
        authorizedByUserId,
        businessDayId,
      })
      throw new Forbidden('PIN ungültig.', { code: 'CASH_SESSION_AUTH_REQUIRED' })
    }

    // 2. Rollencheck: nur privilegierte Mitarbeiter dürfen autorisieren.
    if (!manager.role || !PRIVILEGED_CASH_SESSION_ROLES.has(manager.role)) {
      logger.warn({
        message: 'cash_session.authorize_failed',
        event: 'cash_session.authorize_failed',
        reason: 'role',
        authorizedByUserId,
        businessDayId,
      })
      throw new Forbidden('Dieser Mitarbeiter darf keine Kasse freigeben.', {
        code: 'CASH_SESSION_AUTH_REQUIRED',
      })
    }

    // 3. Kasse intern anlegen (provider:undefined → Härtungs-Hook + multiTenancy-
    //    Stamping übersprungen, daher tenantId/locationId explizit aus dem
    //    Request-Kontext mitgeben). openedBy = Kassierer (privilegierter
    //    Resolver-Pfad akzeptiert das fremde openedBy bei internem Call).
    const requester = params.user as { tenantId?: string; locationId?: string | null } | undefined
    return app.service(cashSessionsPath).create(
      {
        tenantId: requester?.tenantId,
        locationId: requester?.locationId ?? null,
        businessDayId,
        label,
        openedBy,
        openingFloatCents,
      } as CashSessionData,
      { provider: undefined },
    )
  }

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
        // Härtung: externe Direkt-Eröffnung nur durch privilegierte Rollen;
        // STAFF/POS müssen über openAuthorized (Manager-PIN) gehen. Auto-Open +
        // Sync-Apply (intern/fromSync) bleiben erlaubt.
        requireAuthorizedCreate,
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
