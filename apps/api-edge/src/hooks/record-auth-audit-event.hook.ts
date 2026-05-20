// Auth-Audit-Hook: Schreibt LOGIN- und LOGIN_FAILED-Events fuer den
// authentication-Service. Wird in apps/api-edge/src/authentication.ts auf
// after.create + error.create registriert.
//
// LOGIN_FAILED ist tenant-global (locationId = null), weil bei einem
// fehlgeschlagenen Login nicht zwingend bekannt ist, zu welcher Filiale der
// versuchende User gehoert. Der tenantId wird best-effort aus der gesuchten
// E-Mail/Loginname ermittelt — gelingt das nicht, bleibt das Event tenant-los
// und wird nicht persistiert (Cloud-Audit-Pfad nimmt das ohnehin nicht auf,
// weil Tenant-Scope fehlt).
import { uuidv7 } from 'uuidv7'

import {
  AuditAction,
  AuditCategory,
  AuditOutcome,
  AuditSeverity,
  type AuditEventData,
} from '@panary/audit-events/domain'
import { logger } from '@panary/shared-backend'

import type { HookContext } from '../declarations'

const AUTH_PATH = 'authentication'

export const recordAuthSuccess = async (context: HookContext): Promise<void> => {
  if (context.path !== AUTH_PATH) return
  if (context.method !== 'create') return

  const result = context.result as
    | { user?: { _id?: string; tenantId?: string; locationId?: string | null; role?: string } }
    | undefined
  const user = result?.user
  if (!user || !user._id || !user.tenantId) return

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const correlationId = ((context.params as any)?.requestId as string | undefined) ?? uuidv7()
  const data = context.data as { strategy?: string } | undefined

  await writeAuthEvent(context, {
    tenantId: user.tenantId,
    locationId: user.locationId ?? null,
    actorUserId: user._id,
    actorRole: user.role ?? 'unknown',
    correlationId,
    action: AuditAction.LOGIN,
    outcome: AuditOutcome.SUCCESS,
    severity: AuditSeverity.NOTICE,
    metadata: { strategy: data?.strategy ?? 'unknown' },
  })
}

export const recordAuthFailure = async (context: HookContext): Promise<void> => {
  if (context.path !== AUTH_PATH) return
  if (context.method !== 'create') return

  const data = context.data as { strategy?: string; email?: string; loginname?: string } | undefined
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const correlationId = ((context.params as any)?.requestId as string | undefined) ?? uuidv7()

  // tenantId best-effort ueber die users-Tabelle ermitteln. Schlaegt fehl,
  // wenn der Login-Versuch komplett unbekannt ist (z. B. Brute-Force mit
  // willkuerlichen E-Mails) — dann wird das Event verworfen, weil ein
  // tenant-loses Audit forensisch nicht zuordenbar ist.
  const tenantId = await tryResolveTenantId(context, data)
  if (!tenantId) return

  const error = (context.error as { code?: number; message?: string } | undefined) ?? undefined

  await writeAuthEvent(context, {
    tenantId,
    locationId: null,
    actorUserId: 'anonymous',
    actorRole: 'unknown',
    correlationId,
    action: AuditAction.LOGIN_FAILED,
    outcome: AuditOutcome.FAILURE,
    severity: AuditSeverity.WARNING,
    metadata: {
      strategy: data?.strategy ?? 'unknown',
      // Username/Email-Hash waere besser, aber fuer MVP reicht die rohe
      // Information — Login-Audit ist explizit user-bezogen.
      attemptedLoginname: data?.loginname,
      attemptedEmail: data?.email,
      errorCode: error?.code,
      errorMessage: error?.message,
    },
  })
}

interface AuthEventInput {
  tenantId: string
  // null bedeutet: tenant-globaler Eintrag (z.B. LOGIN_FAILED ohne bekannte
  // Filiale). Schema akzeptiert das via `Type.Union([Type.String, Type.Null])`.
  locationId: string | null
  actorUserId: string
  actorRole: string
  correlationId: string
  action: typeof AuditAction.LOGIN | typeof AuditAction.LOGIN_FAILED
  outcome: typeof AuditOutcome.SUCCESS | typeof AuditOutcome.FAILURE
  severity: typeof AuditSeverity.NOTICE | typeof AuditSeverity.WARNING
  metadata?: Record<string, unknown>
}

async function writeAuthEvent(context: HookContext, input: AuthEventInput): Promise<void> {
  const occurredAt = new Date().toISOString()
  const event: AuditEventData = {
    _id: uuidv7(),
    tenantId: input.tenantId,
    locationId: input.locationId,
    occurredAt,
    actor: {
      userId: input.actorUserId,
      role: input.actorRole,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ipAddress: ((context.params as any)?.ip as string | undefined) ?? undefined,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      userAgent: ((context.params as any)?.headers?.['user-agent'] as string | undefined) ?? undefined,
      requestId: input.correlationId,
    },
    target: {
      resource: 'authentication',
      entityType: 'session',
      entityId: input.actorUserId,
    },
    action: input.action,
    category: AuditCategory.ACCESS,
    outcome: input.outcome,
    severity: input.severity,
    metadata: input.metadata,
    correlationId: input.correlationId,
  }

  try {
    // Die flachen Persistenz-Spalten (actor_userId, target_resource etc.)
    // werden vom auditEventDataResolver aus actor/target abgeleitet — hier
    // nicht mehr manuell setzen, sonst lehnt validateData mit
    // "additional properties" ab (additionalProperties:false im Schema).
    await context.app
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .service('audit-events' as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .create(event as unknown as any, { provider: undefined } as any)
  } catch (err) {
    // AJV-Validierungsdetails extrahieren — ohne sieht man nur "validation
    // failed". Feathers `BadRequest` packt das AJV-Array unter `.data`.
    const errAny = err as {
      data?: Array<{ instancePath?: string; message?: string; params?: unknown }>
      errors?: Array<{ instancePath?: string; message?: string; params?: unknown }>
    }
    const ajvErrors =
      Array.isArray(errAny?.data) ? errAny.data
      : Array.isArray(errAny?.errors) ? errAny.errors
      : undefined
    const validationErrors = ajvErrors?.map(e => ({
      path: e.instancePath || '<root>',
      message: e.message ?? '?',
    }))
    logger.warn({
      message: 'Auth-Audit-Event konnte nicht geschrieben werden',
      event: 'audit.auth_record_failed',
      action: input.action,
      tenantId: input.tenantId,
      errorMessage: err instanceof Error ? err.message : String(err),
      validationErrors,
    })
  }
}

async function tryResolveTenantId(
  context: HookContext,
  data: { email?: string; loginname?: string } | undefined,
): Promise<string | null> {
  if (!data) return null
  try {
    const query: Record<string, unknown> = {}
    if (data.email) query.email = data.email
    else if (data.loginname) query.loginname = data.loginname
    else return null
    query['$limit'] = 1
    query['$select'] = ['_id', 'tenantId']

    const found = (await context.app
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .service('users' as any)
      .find({ query, provider: undefined })) as
      | { data: { tenantId?: string }[] }
      | { tenantId?: string }[]

    const items = Array.isArray(found) ? found : found.data
    if (items.length > 0 && items[0].tenantId) return items[0].tenantId
    return null
  } catch {
    return null
  }
}
