import crypto from 'node:crypto'
import type { Application } from './declarations'
import { logger } from '@panary/shared-backend'
import { DeviceType } from '@panary/devices/domain'
import { UserSystemRole } from '@panary/users/domain'

/**
 * Geraete-Pairing per Kurz-Code.
 *
 * Statt am Touch-Terminal Admin-E-Mail + Passwort zu tippen, fordert ein
 * eingeloggter Admin am Edge (Admin-Panel) einen 6-stelligen Pairing-Code an
 * und liest ihn am POS-Terminal ab. Der Code ist kurzlebig (TTL), single-use
 * und an Tenant + Standort des Admins gebunden.
 *
 * Bewusste Abweichung vom Feathers-Service-Muster: `secureByDefault` wirkt
 * pro-Service granular. Ein oeffentlicher `redeem` neben einem geschuetzten
 * `requestCode` liesse sich nur ueber `publicServices` (zu grob) oder
 * client-seitige Custom-Method-Registrierung loesen. Zwei Plain-Koa-Routen
 * (wie `/health` und der Setup-Modus) sind hier einfacher und risikoaermer:
 *  - POST /device-pairing/request-code  (authentifiziert: TENANT_OWNER/MANAGER)
 *  - POST /device-pairing/redeem        (oeffentlich, rate-limited)
 *
 * Der Code-Store ist bewusst In-Memory: Codes leben nur Minuten, ein
 * Edge-Neustart darf sie verfallen lassen — kein Migrations-/Persistenzbedarf.
 */

const PAIRING_CODE_TTL_MS = 10 * 60 * 1000 // 10 Minuten
const PAIRING_CODE_LENGTH = 6
const ALLOWED_REQUEST_ROLES = new Set<string>([
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_MANAGER,
])

// Rate-Limit fuer redeem: max. fehlgeschlagene Versuche pro IP im Zeitfenster.
// Verhindert Brute-Force des 6-stelligen Codes (10^6 Raum) im LAN.
const REDEEM_MAX_FAILURES = 10
const REDEEM_FAILURE_WINDOW_MS = 60 * 1000

interface PairingCodeRecord {
  tenantId: string
  locationId: string
  createdBy: string
  expiresAt: number
}

interface FailureRecord {
  count: number
  windowStart: number
}

const codeStore = new Map<string, PairingCodeRecord>()
const failureStore = new Map<string, FailureRecord>()

function purgeExpired(): void {
  const now = Date.now()
  for (const [code, rec] of codeStore) {
    if (rec.expiresAt <= now) codeStore.delete(code)
  }
}

function generateUniqueCode(): string {
  // crypto.randomInt → nicht erratbarer Code; bei (extrem seltener) Kollision
  // neu wuerfeln.
  for (let i = 0; i < 10; i++) {
    const n = crypto.randomInt(0, 10 ** PAIRING_CODE_LENGTH)
    const code = String(n).padStart(PAIRING_CODE_LENGTH, '0')
    if (!codeStore.has(code)) return code
  }
  throw new Error('Pairing-Code konnte nicht erzeugt werden')
}

function isRateLimited(ip: string): boolean {
  const rec = failureStore.get(ip)
  if (!rec) return false
  if (Date.now() - rec.windowStart > REDEEM_FAILURE_WINDOW_MS) {
    failureStore.delete(ip)
    return false
  }
  return rec.count >= REDEEM_MAX_FAILURES
}

function recordFailure(ip: string): void {
  const now = Date.now()
  const rec = failureStore.get(ip)
  if (!rec || now - rec.windowStart > REDEEM_FAILURE_WINDOW_MS) {
    failureStore.set(ip, { count: 1, windowStart: now })
  } else {
    rec.count++
  }
}

async function resolveUserFromRequest(app: Application, authHeader?: string) {
  if (!authHeader?.startsWith('Bearer ')) return null
  const accessToken = authHeader.slice('Bearer '.length).trim()
  if (!accessToken) return null
  try {
    // authentication ist in secureByDefault.publicServices → intern aufrufbar.
    const result = await app.service('authentication').create({ strategy: 'jwt', accessToken }, {})
    return (result as { user?: Record<string, unknown> })?.user ?? null
  } catch {
    return null
  }
}

export function registerDevicePairingRoutes(app: Application): void {
  app.use(async (ctx, next) => {
    // --- requestCode (authentifiziert: TENANT_OWNER / TENANT_MANAGER) ---
    if (ctx.path === '/device-pairing/request-code' && ctx.method === 'POST') {
      const user = (await resolveUserFromRequest(
        app,
        ctx.headers['authorization'] as string | undefined,
      )) as Record<string, any> | null

      if (!user) {
        ctx.status = 401
        ctx.body = { error: 'unauthenticated' }
        return
      }
      if (!ALLOWED_REQUEST_ROLES.has(user['role'])) {
        ctx.status = 403
        ctx.body = { error: 'forbidden' }
        return
      }

      const tenantId: string | null = user['tenantId'] ?? null
      const body = ((ctx.request as { body?: Record<string, unknown> }).body ?? {}) as Record<string, unknown>
      // locationId aus Body (Admin waehlt Standort) > user.locationId (vom
      // multiTenancy-Resolver) > activeLocationId.
      const locationId: string | null =
        (typeof body['locationId'] === 'string' ? (body['locationId'] as string) : null) ??
        user['locationId'] ??
        user['activeLocationId'] ??
        null

      if (!tenantId || !locationId) {
        ctx.status = 400
        ctx.body = {
          error: 'missing_location',
          message: 'Tenant oder Standort fehlt — bitte zuerst einen Standort wählen.',
        }
        return
      }

      purgeExpired()
      const code = generateUniqueCode()
      const expiresAt = Date.now() + PAIRING_CODE_TTL_MS
      codeStore.set(code, { tenantId, locationId, createdBy: user['_id'], expiresAt })

      logger.info({
        message: 'Pairing-Code ausgestellt',
        event: 'device_pairing.code_issued',
        tenantId,
        locationId,
        userId: user['_id'],
        // Code selbst NICHT loggen (sensibel)
      })

      ctx.status = 200
      ctx.body = {
        code,
        expiresAt: new Date(expiresAt).toISOString(),
        ttlSeconds: PAIRING_CODE_TTL_MS / 1000,
      }
      return
    }

    // --- redeem (oeffentlich, rate-limited) ---
    if (ctx.path === '/device-pairing/redeem' && ctx.method === 'POST') {
      const ip = ctx.ip || 'unknown'
      if (isRateLimited(ip)) {
        ctx.status = 429
        ctx.body = { error: 'too_many_attempts' }
        return
      }

      const body = ((ctx.request as { body?: Record<string, unknown> }).body ?? {}) as Record<string, unknown>
      const code = typeof body['code'] === 'string' ? (body['code'] as string).trim() : ''
      const deviceName = typeof body['deviceName'] === 'string' ? (body['deviceName'] as string).trim() : ''
      const deviceType = typeof body['deviceType'] === 'string' ? (body['deviceType'] as string) : DeviceType.POS_COUNTER

      purgeExpired()
      const record = code ? codeStore.get(code) : undefined
      if (!record || record.expiresAt <= Date.now()) {
        recordFailure(ip)
        ctx.status = 400
        ctx.body = { error: 'invalid_code', message: 'Code ungültig oder abgelaufen.' }
        return
      }
      if (!deviceName) {
        ctx.status = 400
        ctx.body = { error: 'missing_device_name' }
        return
      }
      if (!Object.values(DeviceType).includes(deviceType as (typeof DeviceType)[keyof typeof DeviceType])) {
        ctx.status = 400
        ctx.body = { error: 'invalid_device_type' }
        return
      }

      // Single-use: Code SOFORT invalidieren (vor dem create), damit ein
      // paralleler Redeem nicht zwei Geraete anlegt.
      codeStore.delete(code)

      try {
        const device = (await app.service('devices').create(
          {
            name: deviceName,
            type: deviceType as (typeof DeviceType)[keyof typeof DeviceType],
            // SICHERHEIT: tenantId/locationId AUSSCHLIESSLICH aus dem Code-Record,
            // nie aus dem Request-Body. multiTenancy stempelt bei provider:undefined
            // nicht — daher explizit setzen.
            tenantId: record.tenantId,
            locationId: record.locationId,
          },
          { provider: undefined },
        )) as Record<string, any>

        // organizationName fuer die Anzeige im Wizard nachschlagen (best-effort).
        let organizationName: string | undefined
        try {
          const loc = (await app.service('locations').get(record.locationId, {
            provider: undefined,
          })) as Record<string, any>
          organizationName = loc?.['organizationName'] || loc?.['name']
        } catch {
          // ignore — Anzeige-Name ist optional
        }

        ctx.status = 201
        ctx.body = {
          deviceId: device['deviceId'],
          apiKey: device['apiKey'],
          name: device['name'],
          type: device['type'],
          tenantId: device['tenantId'],
          locationId: device['locationId'],
          organizationName,
        }
        logger.info({
          message: 'Geraet via Pairing-Code registriert',
          event: 'device_pairing.redeemed',
          tenantId: record.tenantId,
          locationId: record.locationId,
          deviceId: device['deviceId'],
        })
      } catch (err) {
        logger.error({
          message: 'Pairing-Redeem: Geraete-Registrierung fehlgeschlagen',
          event: 'device_pairing.redeem_failed',
          error: err instanceof Error ? err.message : String(err),
        })
        ctx.status = 500
        ctx.body = { error: 'registration_failed' }
      }
      return
    }

    await next()
  })
}
