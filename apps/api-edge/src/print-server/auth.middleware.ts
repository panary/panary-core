import type { Middleware } from '@feathersjs/koa'
import { AppAction, AppResource, PermissionRule, RolePermissions, UserSystemRole } from '@panary/users/domain'
import type { Application } from '../declarations'
import { logger } from '@panary/shared-backend'
import { sha256, timingSafeCompare } from '../utils/crypto.utils'
import { stampApiKeyLastUsed } from '../utils/apikey-last-used'

/**
 * Koa-Middleware für Authentifizierung auf Print-Server-Endpoints.
 * Unterstützt zwei Mechanismen:
 *   1. JWT-Token via `Authorization: Bearer <token>` (Admin-Panel)
 *   2. API-Key via `X-Api-Key` + `X-Device-Id` Header (POS-Geräte)
 */
export function printServerAuth(app: Application): Middleware {
  return async (ctx, next) => {
    const apiKey = ctx.headers['x-api-key'] as string | undefined
    const deviceId = ctx.headers['x-device-id'] as string | undefined
    const authHeader = ctx.headers.authorization

    // --- Variante 1: API-Key Auth (POS-Geräte) ---
    if (apiKey && deviceId) {
      try {
        // API-Keys werden als SHA-256-Hash gespeichert (apikeyDataResolver) — der
        // eingehende Klartext-Key muss vor dem Lookup gehasht werden. Lookup über den
        // apikeyPrefix-Index (erste 8 Zeichen), danach timing-safe Hash-Vergleich gegen
        // die Kandidaten. Identisches Muster wie der WebSocket-Handshake in channels.ts.
        const inputHash = sha256(apiKey)
        const inputPrefix = apiKey.slice(0, 8)
        const apiKeyResult: any = await app.service('apikeys').find({
          query: { apikeyPrefix: inputPrefix, deviceId, $limit: 5 },
          provider: undefined,
          paginate: false,
        })

        const candidates: any[] = Array.isArray(apiKeyResult) ? apiKeyResult : (apiKeyResult?.data ?? [])
        const keyRecord = candidates.find(entry => entry.active && timingSafeCompare(inputHash, entry.apikey))

        if (!keyRecord) {
          ctx.status = 401
          ctx.body = { error: 'Ungültiger oder deaktivierter API-Key' }
          return
        }

        // Nutzung stempeln — gedrosselt, weil dieser Pfad pro HTTP-Request laeuft.
        stampApiKeyLastUsed(app, keyRecord._id)

        // Virtuellen User erstellen (wie allowApiKey-Hook)
        ctx.state.user = {
          _id: `device:${deviceId}`,
          role: keyRecord.deviceRole || UserSystemRole.DEVICE_POS,
          tenantId: keyRecord.tenantId,
          locationId: keyRecord.locationId,
          activeLocationId: keyRecord.locationId,
        }
        ctx.state.authenticated = true
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn({
          message: `Print-Server API-Key Auth fehlgeschlagen: ${message}`,
          event: 'print-server.apikey_fail',
        })
        ctx.status = 401
        ctx.body = { error: 'API-Key Validierung fehlgeschlagen' }
        return
      }

      return next()
    }

    // --- Variante 2: JWT Auth (Admin-Panel) ---
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.slice(7)

      try {
        const authService = app.service('authentication') as any
        const payload = await authService.verifyAccessToken(token)
        const userId = payload.sub

        if (!userId) {
          ctx.status = 401
          ctx.body = { error: 'Ungültiger Token: kein Benutzer' }
          return
        }

        const user = await app.service('users').get(userId, { provider: undefined })
        ctx.state.user = user
        ctx.state.authenticated = true
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        logger.warn({ message: `Print-Server JWT Auth fehlgeschlagen: ${message}`, event: 'print-server.jwt_fail' })
        ctx.status = 401
        ctx.body = { error: 'Ungültiges oder abgelaufenes Token' }
        return
      }

      return next()
    }

    // --- Kein Auth-Header ---
    ctx.status = 401
    ctx.body = { error: 'Authentifizierung erforderlich (Bearer-Token oder X-Api-Key)' }
  }
}

/**
 * Koa-Middleware für Rollen-basierte Zugriffskontrolle auf Print-Server-Endpoints.
 */
export function printServerAuthorize(requiredAction: AppAction): Middleware {
  return async (ctx, next) => {
    const user = ctx.state.user
    if (!user) {
      ctx.status = 401
      ctx.body = { error: 'Nicht authentifiziert' }
      return
    }

    // Platform Owner Bypass
    if (user.role === UserSystemRole.PLATFORM_OWNER) {
      return next()
    }

    const roleRules = RolePermissions[user.role as UserSystemRole] || []
    const hasPermission = roleRules.some((rule: PermissionRule) => {
      if (typeof rule === 'string') return false
      if (rule.resource !== AppResource.PRINT_SERVER && rule.resource !== AppResource.SYSTEM) return false
      if (rule.action === AppAction.MANAGE) return true
      if (Array.isArray(rule.action)) return rule.action.includes(requiredAction)
      return rule.action === requiredAction
    })

    if (!hasPermission) {
      ctx.status = 403
      ctx.body = { error: 'Keine Berechtigung für diese Aktion' }
      return
    }

    await next()
  }
}
