// Append-only Audit-Events-Service (Edge / SQLite).
//
// - Methoden: find, get, create. update/patch/remove sind NICHT registriert
//   und werden von Feathers automatisch mit MethodNotAllowed abgelehnt.
// - `create` ist intern only: `provider` muss undefined sein, sonst Forbidden.
// - Tenant-Isolation via multiTenancy(); allowGlobalData=true erlaubt das
//   Anzeigen von tenant-globalen Eintraegen (z. B. Logins ohne locationId).
// - Append-only zusaetzlich auf DB-Layer durch SQLite-Trigger gesichert
//   (siehe Migration 20260506000001_audit_events.ts).
import { authenticate } from '@feathersjs/authentication'
import { Forbidden } from '@feathersjs/errors'
import { hooks as schemaHooks, resolve } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'
import { uuidv7 } from 'uuidv7'

import {
  type AuditEvent,
  type AuditEventData,
  auditEventDataSchema,
  auditEventQuerySchema,
} from '@panary/audit-events/domain'
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

export const auditEventsPath = 'audit-events'

const AUDIT_JSON_FIELDS = ['actor', 'target', 'before', 'after', 'diff', 'metadata']

const auditEventDataValidator = getValidator(auditEventDataSchema, dataValidator)
const auditEventQueryValidator = getValidator(auditEventQuerySchema, queryValidator)

const auditEventResolver = resolve<AuditEvent, HookContext>({})

const auditEventExternalResolver = resolve<AuditEvent, HookContext>({
  // before/after/diff sind potenziell PII-haltig (z. B. E-Mail-Aenderung).
  // Wir maskieren sie nur fuer Rollen ohne CAN_READ_SENSITIVE_USER_DATA-Ability.
  // TENANT_OWNER und TENANT_TECHNICIAN haben die Ability — andere Rollen
  // sehen nur Action/Category/Actor/Target.
  before: async (value, _entity, context) => {
    return canReadSensitive(context) ? value : undefined
  },
  after: async (value, _entity, context) => {
    return canReadSensitive(context) ? value : undefined
  },
  diff: async (value, _entity, context) => {
    return canReadSensitive(context) ? value : undefined
  },
})

function canReadSensitive(context: HookContext): boolean {
  const user = context.params?.user as { permissions?: string[] } | undefined
  if (!user) return true // interne Aufrufe sehen alles
  return Array.isArray(user.permissions) && user.permissions.includes('can_read_sensitive_user_data')
}

const auditEventDataResolver = resolve<AuditEvent, HookContext>({
  _id: async value => value || uuidv7(),
  createdAt: async (value, entity) => value || (entity as { occurredAt?: string })?.occurredAt || new Date().toISOString(),
  updatedAt: async (value, entity) => value || (entity as { occurredAt?: string })?.occurredAt || new Date().toISOString(),
  // Flache Persistenz-Spiegel aus den verschachtelten Feldern ableiten.
  // SQLite-Migration verlangt sie als notNullable — Index-Lookups (z.B.
  // "alle Events fuer userId=X") laufen ueber diese flachen Spalten.
  actor_userId: async (value, entity) =>
    value || (entity as { actor?: { userId?: string } })?.actor?.userId,
  target_resource: async (value, entity) =>
    value || (entity as { target?: { resource?: string } })?.target?.resource,
  target_entityType: async (value, entity) =>
    value || (entity as { target?: { entityType?: string } })?.target?.entityType,
  target_entityId: async (value, entity) =>
    value || (entity as { target?: { entityId?: string } })?.target?.entityId,
})

const auditEventQueryResolver = resolve<AuditEvent, HookContext>({})

// Around-Hook: blockt externe Schreibzugriffe. Nur intern erzeugte Events
// (via app.service('audit-events').create(..., { provider: undefined }))
// sind erlaubt — verhindert Audit-Manipulation.
const blockExternalWrites = async (context: HookContext, next: NextFunction) => {
  if (context.method === 'create' && context.params.provider) {
    throw new Forbidden('Audit-Events werden nur intern erzeugt')
  }
  await next()
}

export const auditEvents = (app: Application) => {
  const paginate = app.get('paginate')
  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let Model: any
  if (dbType === DatabaseType.SQLITE) Model = app.get('sqliteClient')

  const service = createServiceAdapter<AuditEvent, AuditEventData>(app, {
    name: auditEventsPath,
    Model,
    paginate,
    id: '_id',
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  app.use(auditEventsPath, service as any, {
    methods: ['find', 'get', 'create'],
    events: [],
  })

  const jsonHooks = getJsonFieldHooks(app, AUDIT_JSON_FIELDS)

  app.service(auditEventsPath).hooks({
    around: {
      all: [
        blockExternalWrites,
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false, allowGlobalData: true }),
        schemaHooks.resolveExternal(auditEventExternalResolver),
        schemaHooks.resolveResult(auditEventResolver),
      ],
    },
    before: {
      all: [
        schemaHooks.validateQuery(auditEventQueryValidator),
        schemaHooks.resolveQuery(auditEventQueryResolver),
      ],
      create: [
        schemaHooks.validateData(auditEventDataValidator),
        schemaHooks.resolveData(auditEventDataResolver),
        // JSON-Felder vor dem SQLite-Insert in Strings konvertieren
        ...jsonHooks.before,
      ],
    },
    after: {
      all: [
        // JSON-Felder nach dem Lesen zurueckparsen (SQLite-only — Mongo no-op)
        ...jsonHooks.after,
      ],
    },
    error: { all: [] },
  })
}
