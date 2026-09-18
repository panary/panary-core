import type { Middleware } from '@feathersjs/koa'
import { AppAction, AppResource, hasEffectivePermission, UserSystemRole } from '@panary/users/domain'
import type { Application } from '../declarations'
import { logger } from '@panary/shared-backend'
import { stampApiKeyLastUsed } from '../utils/apikey-last-used'
import { authenticateDeviceApiKey } from '../utils/device-apikey-auth'

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
        // Dieselbe Pruefung wie der WebSocket-Handshake — buchstaeblich dieselbe
        // Funktion (ADR 0042). Entscheidend ist hier die pending-Annahme: Nach
        // einer Rotation im Handshake schickt der Client sofort den NEUEN
        // Schluessel. Eine Pruefstelle, die nur den gespeicherten Hash kennt,
        // antwortete ab diesem Moment 401 — die Kasse laeuft weiter, die Bons
        // brechen ab. Karenz und Promotion greifen deshalb identisch.
        //
        // `canIssue: false`: Ausgestellt wird nur dort, wo der Client den neuen
        // Schluessel auch entgegennimmt (Socket-Event). Ueber HTTP entstuende
        // ein Schluessel, den niemand abholt.
        const auth = await authenticateDeviceApiKey(app, {
          rawKey: apiKey,
          deviceId,
          transport: 'http',
          canIssue: false,
        })

        if (!auth.ok) {
          ctx.status = 401
          ctx.body = {
            error:
              auth.reason === 'expired'
                ? 'API-Key abgelaufen — Gerät neu koppeln'
                : 'Ungültiger oder deaktivierter API-Key',
          }
          return
        }

        const keyRecord = auth.record

        // Nutzung stempeln — gedrosselt, weil dieser Pfad pro HTTP-Request laeuft.
        stampApiKeyLastUsed(app, keyRecord._id)

        // Virtuellen User erstellen (wie allowApiKey-Hook)
        //
        // 🚨 Hier stand bis #329 `keyRecord.deviceRole` — ein Feld, das es auf
        // einem apikeys-Record NIE gab (`apikeySchema` kennt nur `role` und ist
        // `additionalProperties: false`; `deviceRole` entsteht erst auf der
        // Socket-Connection, siehe channels.ts). Der Ausdruck war damit immer
        // `undefined` und der `|| DEVICE_POS`-Fallback deckelte JEDEN Schluessel
        // auf POS-Rechte — unabhaengig von seiner echten Rolle.
        //
        // Kein Fallback mehr: Fehlt die Rolle, bleibt `role` undefined und
        // `printServerAuthorize` antwortet 403 samt `print-server.forbidden` —
        // sichtbar statt lautlos. Das ist Defense-in-Depth, kein erwarteter
        // Bestandsfall: `apikeys.role` ist in SQLite `NOT NULL`. Ein Fallback
        // hier waere trotzdem falsch, weil er ausgerechnet den Datenfehler
        // zudeckte, der ihn ausloest.
        ctx.state.user = {
          _id: `device:${deviceId}`,
          role: keyRecord.role,
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
    // Wide-Event, weil `/print-server/*` rohe Koa-Routen sind: sie laufen nicht
    // durch `canonicalLog` und tauchen daher in KEINEM Request-Log auf. Ohne
    // diese Zeile ist ein Druckauftrag ohne Credentials nicht von "nie
    // abgeschickt" zu unterscheiden.
    logger.warn({
      message: 'Print-Server-Aufruf ohne Credentials abgewiesen',
      event: 'print-server.unauthenticated',
      path: ctx.path,
      method: ctx.method,
    })
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

    // Geteilte Auswertung mit dem `authorize`-Hook: Rollen-Matrix ODER
    // additiver Pro-User-Grant (`grant:print-server:<action>`). Vorher las diese
    // Middleware die rohe `RolePermissions`-Matrix und ignorierte damit als
    // einzige Stelle im Edge die vergebenen Grants.
    const hasPermission = hasEffectivePermission(
      user.role as UserSystemRole,
      user.permissions as string[] | undefined,
      AppResource.PRINT_SERVER,
      requiredAction,
    )

    if (!hasPermission) {
      // Siehe `print-server.unauthenticated`: ohne dieses Wide-Event ist ein
      // 403 im Edge-Log unsichtbar.
      logger.warn({
        message: 'Print-Server-Aufruf ohne Berechtigung abgewiesen',
        event: 'print-server.forbidden',
        path: ctx.path,
        method: ctx.method,
        // `?? null` statt `user.role`: Ein Schluessel ohne Rolle laesst das Feld
        // sonst ganz aus dem Wide-Event fallen — und genau dieser Fall ist der,
        // den man im Log sehen will (seit #329 gibt es keinen POS-Fallback mehr).
        role: user.role ?? null,
        requiredAction,
      })
      ctx.status = 403
      ctx.body = { error: 'Keine Berechtigung für diese Aktion' }
      return
    }

    await next()
  }
}
