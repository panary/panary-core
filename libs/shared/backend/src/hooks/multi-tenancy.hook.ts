import { HookContext, NextFunction } from '../declarations'
import { UserSystemRole } from '@panary/users/domain'
import { logger } from '../logger'

export interface MultiTenancyOptions {
  isolateLocation?: boolean // Soll nach Filiale gefiltert werden?
  allowGlobalData?: boolean // Dürfen globale Daten (locationId: null) gesehen werden?
}

/**
 * Marker auf dem zurueckgegebenen Hook, damit der Boot-Check
 * (`assert-stamp-fields.ts`) die Optionen eines registrierten Services aus
 * `service.__hooks.around.all` zurueckgewinnen kann. Ohne Marker muesste der
 * Check die Optionen dupliziert pflegen — und wuerde bei jedem neuen Service
 * lautlos driften.
 */
export const MULTI_TENANCY_OPTIONS = Symbol.for('panary.multiTenancy.options')

/**
 * Die effektive Filiale eines Users.
 *
 * Am Edge gibt es ZWEI Quellen, weil `params.user` aus zwei Welten stammt:
 *
 * - **JWT-User** (Mensch, Admin-Panel/POS-Login): das `users`-Dokument. Dessen
 *   Schema kennt ueberhaupt kein `locationId` (`additionalProperties: false`),
 *   die Spalte existiert in keiner Migration — kanonisch ist `activeLocationId`.
 * - **API-Key-User** (Geraet, WebSocket): der virtuelle User aus
 *   `allow-apikey.hook.ts`, der `locationId` UND `activeLocationId` setzt.
 *
 * Der Hook las frueher ausschliesslich `user.locationId` und war damit fuer
 * JEDEN angemeldeten Menschen wirkungslos: Writes bekamen keinen Stamp (→ 400
 * "must have required property 'locationId'" auf allen Services mit
 * `isolateLocation` und Pflicht-`locationId` im Data-Schema, z. B. `apikeys`),
 * und das READ-Scoping fiel still aus (Staff sah alle Filialen).
 *
 * Dieselbe Fallback-Kette steht bereits in `canonical-log.hook.ts`,
 * `users.schema.ts` und `device-pairing.ts` — hier ist sie die einzige Quelle.
 */
export const resolveUserLocationId = (user: Record<string, any> | undefined | null): string | null =>
  user?.['locationId'] ?? user?.['activeLocationId'] ?? null

// 3. SCHICHT: Daten-Isolation (Multi-Tenancy)
// Prüft: Gehört der angefragte User zu meinem Tenant?
// Konfiguration:
// - isolateLocation: true -> Staff sieht nur Kollegen seiner Filiale?
// - allowGlobalData: false -> User gehören immer fest zu etwas.
export const multiTenancy = (options: MultiTenancyOptions = {}) => {
  const hook = async (context: HookContext, next: NextFunction) => {
    const { isolateLocation = false, allowGlobalData = false } = options
    const { user } = context.params

    // 1. Interne Aufrufe (kein User/Provider) durchlassen
    if (!user) return next()

    const userLocationId = resolveUserLocationId(user)

    // 2. Platform Bypass: Admins sehen alles (READ), aber Stamping bei WRITE
    if (user.role && user.role.startsWith('platform:')) {
      if (['create', 'update', 'patch'].includes(context.method)) {
        const data = context.data || {}
        // Bulk-Create (multi: ['create']) liefert ein Array — jedes Element
        // einzeln stempeln, sonst landet der Stamp nur als Property auf dem
        // Array-Objekt und die Elemente bleiben ungestempelt.
        for (const item of Array.isArray(data) ? data : [data]) {
          await stampEdgeDefaults(context, item, user, isolateLocation, userLocationId)
        }
        context.data = data
      }
      return next()
    }

    // ---------------------------------------------------------
    // WRITE OPERATIONS (create, update, patch) -> "Stamping"
    // Wir erzwingen, dass Daten dem Ersteller "gehören".
    // ---------------------------------------------------------
    if (['create', 'update', 'patch'].includes(context.method)) {
      const data = context.data || {}

      // Letzte Rettung, wenn WEDER Payload NOCH User eine Filiale liefern (z. B.
      // ein aus der Cloud gepullter tenant:owner, dessen activeLocationId noch
      // nicht gesetzt ist). Ohne diesen Lookup bliebe `locationId` ungestempelt
      // und Services mit Pflicht-locationId im Data-Schema quittierten mit einem
      // irrefuehrenden 400. Analog zu `ensureFallbackLocation` im Cloud-Hook:
      // hoechstens EIN Lookup pro Request, im Closure gecacht.
      let fallbackLocationId: string | null | undefined
      const ensureFallbackLocation = async (): Promise<string | null> => {
        if (fallbackLocationId !== undefined) return fallbackLocationId
        try {
          const result = (await context.app.service('locations').find({
            query: { tenantId: user.tenantId, $limit: 1, $select: ['_id'] },
            paginate: false,
          })) as any
          const list = Array.isArray(result) ? result : (result?.data ?? [])
          fallbackLocationId = list[0]?._id ?? null
        } catch {
          fallbackLocationId = null
        }
        return fallbackLocationId ?? null
      }

      // Bulk-Create liefert ein Array — ohne elementweises Stamping bliebe
      // eine client-seitig gesendete fremde tenantId auf den Elementen stehen
      // (Cross-Tenant-Injection am Stamp-Schutz vorbei).
      for (const item of Array.isArray(data) ? data : [data]) {
        // A. Tenant ist Pflicht
        item.tenantId = user.tenantId

        // B. Location ist optional (aber für Staff Pflicht)
        if (isolateLocation) {
          // Wenn ich Staff bin, MUSS ich Daten meiner Filiale zuordnen
          // Wenn ich Owner bin, DARF ich wählen (Default: Meine Homebase)
          //
          // ENTSCHIEDEN (User-Entscheid 2026-07-04): Der truthy-Check ueberstempelt
          // BEWUSST auch explizites locationId='' und null — bewusste Abweichung von
          // der Cloud-Semantik, in der ''="alle Filialen" eine Admin-Frontend-
          // Konvention ist. Gruende: (1) eine Edge-Installation bedient genau EINE
          // Filiale, (2) ''-Datensaetze waeren fuer die filial-gescopten POS-Reads
          // unsichtbar, (3) Sync-Pfade laufen intern (kein user) ungestempelt an
          // diesem Check vorbei. NICHT auf `!= null` "fixen".
          if (!item.locationId) {
            const stamp = userLocationId ?? (await ensureFallbackLocation())
            // Nur stempeln, wenn wirklich etwas da ist — lieber ungestempelt in
            // die Schema-Validierung laufen als `locationId: null` schreiben.
            if (stamp) item.locationId = stamp
          }
        }
      }
      context.data = data
    }

    // ---------------------------------------------------------
    // READ OPERATIONS (find, get, remove) -> "Scoping"
    // Wir filtern die Sicht auf die Daten.
    // ---------------------------------------------------------
    if (['find', 'get', 'remove', 'update', 'patch'].includes(context.method)) {
      const query = context.params.query || {}

      // A. Tenant Isolation (Harter Filter)
      query.tenantId = user.tenantId

      // B. Location Isolation
      if (isolateLocation) {
        // Privilegierte User (Chef/Manager) sehen ALLE Filialen
        const isPrivileged = [UserSystemRole.TENANT_OWNER, UserSystemRole.TENANT_MANAGER].includes(
          user.role as UserSystemRole
        )

        // Normale Mitarbeiter sehen NUR ihre Filiale
        if (!isPrivileged && userLocationId) {
          logger.debug({
            message: '[Security] multiTenancy: Location-Isolation aktiv',
            event: 'security.location_scoped',
            userId: user._id,
            userRole: user.role,
            locationId: userLocationId,
            service: context.path,
            method: context.method,
          })
          if (allowGlobalData) {
            // Zeige: Meine Filiale ODER Globale Daten
            query.$or = [{ locationId: userLocationId }, { locationId: null }]
          } else {
            // Zeige: NUR Meine Filiale
            query.locationId = userLocationId
          }
        }
      }

      context.params.query = query
    }

    return next()
  }

  // Optionen am Hook hinterlegen, damit der Boot-Check sie aus
  // `service.__hooks.around.all` zurueckgewinnen kann (siehe MULTI_TENANCY_OPTIONS).
  Object.defineProperty(hook, MULTI_TENANCY_OPTIONS, { value: options, enumerable: false })

  return hook
}

/**
 * Edge-Modus: Fehlende tenantId automatisch aus der einzigen Location ermitteln.
 * Wird für platform:*-User verwendet, die keinen eigenen Tenant haben.
 * locationId wird NUR gestempelt, wenn es bereits im Data vorhanden ist (also vom Schema erlaubt),
 * AUSSER wenn isolateLocation=true — dann wird sie auch ohne Vorhandensein im Data gesetzt.
 */
async function stampEdgeDefaults(
  context: HookContext,
  data: Record<string, any>,
  user: Record<string, any>,
  isolateLocation: boolean,
  userLocationId: string | null,
): Promise<void> {
  if (data.tenantId && !isolateLocation && !('locationId' in data)) return

  let tenantId = user.tenantId
  let locationId = userLocationId

  // Wenn der User keinen Tenant hat, den einzigen vorhandenen ermitteln
  if (!tenantId || !locationId) {
    const locations = (await context.app.service('locations').find({
      query: { $limit: 1, $select: ['_id', 'tenantId'] },
    })) as any
    if (locations.data?.length > 0) {
      tenantId = tenantId || locations.data[0].tenantId
      locationId = locationId || locations.data[0]._id
    }
  }

  if (!data.tenantId && tenantId) data.tenantId = tenantId
  // locationId setzen: bei isolateLocation auch ohne Vorhandensein im Data (Platform-Owner + location-isolierter Service)
  if (isolateLocation && !data.locationId && locationId) {
    data.locationId = locationId
  } else if ('locationId' in data && !data.locationId && locationId) {
    data.locationId = locationId
  }
}
