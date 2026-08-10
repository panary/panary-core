import { HookContext } from '@feathersjs/feathers'
import { BadRequest, NotAuthenticated } from '@feathersjs/errors'
import { User } from '@panary/users/domain'
import { Location } from '@panary/locations/domain'
import { PairingStatus, CloudConnection } from '@panary/cloud-connection/domain'
import { AppError, AppErrorMessages } from '@panary/shared-common'
import { logger } from '@panary/shared-backend'
import { getHoursSince, hasActiveOrders, rotateBusinessDay, shouldAutoRotate } from '../utils/business-day.utils'

/**
 * Letzte Verteidigungslinie, wenn weder Standort noch Config einen Wert liefern.
 * 26 Stunden ist die Schwelle aus panary-cloud ADR 0036 — bewusst nicht 24,
 * damit ein Nachtbetrieb 18:00 → 04:00 nicht allein durch den
 * Kalendertagswechsel auffaellt. Muss mit dem Cloud-Default identisch bleiben:
 * zwei verschieden frueh sperrende Gates waeren genau die Drift, die
 * ADR 0047 beendet.
 */
const DEFAULT_MAX_OPEN_HOURS = 26

/**
 * Liest die aktive `cloud-connection`-Verbindung (CONNECTED) und prueft, ob
 * der Operator gerade einen Offline-Override aktiviert hat (Banner-Action
 * im Admin-Client). Liefert `null`, wenn kein Pairing aktiv ist (= Standalone).
 *
 * Im Standalone-Modus (`null`) UND im Connected-Modus mit aktivem
 * Offline-Override darf `rotateBusinessDay()` laufen. Im Connected-Modus
 * ohne Override blockiert der Hook neue Bestellungen mit klarer Operator-
 * Message.
 */
async function getConnectedCloudConnection(context: HookContext): Promise<CloudConnection | null> {
  try {
    const result = await context.app.service('cloud-connection').find({
      provider: undefined,
      paginate: false,
      query: { pairingStatus: PairingStatus.CONNECTED, $limit: 1 },
    })
    const list = Array.isArray(result) ? result : []
    return (list[0] as CloudConnection | undefined) ?? null
  } catch {
    return null
  }
}

function isOfflineOverrideActive(connection: CloudConnection): boolean {
  const until = connection.offlineOverrideActiveUntil
  if (!until) return false
  const untilMs = new Date(until).getTime()
  if (Number.isNaN(untilMs)) return false
  return untilMs > Date.now()
}

/**
 * Ermittelt die locationId anhand des Authentifizierungstyps (API-Key oder User).
 */
async function resolveLocationId(context: HookContext): Promise<string> {
  const { app, params } = context
  const { user } = params

  const isApiKey = params.apiKey || params.authentication?.strategy === 'apiKey'

  if (isApiKey) {
    const apiKeyLocationId =
      (params.locationId as string | undefined) || (params.connection?.locationId as string | undefined)

    if (!apiKeyLocationId) {
      throw new BadRequest(AppErrorMessages[AppError.LOCATION_NOT_ASSIGNED], {
        code: AppError.LOCATION_NOT_ASSIGNED,
      })
    }
    return apiKeyLocationId
  }

  if (!user) {
    throw new NotAuthenticated(AppErrorMessages[AppError.AUTH_UNAUTHENTICATED], {
      code: AppError.AUTH_UNAUTHENTICATED,
    })
  }

  const existingUser: User = await app.service('users').get(user._id, {
    query: { $select: ['activeLocationId'] },
    provider: undefined,
  })

  if (existingUser.activeLocationId) {
    return existingUser.activeLocationId as string
  }

  // Fallback ohne zugewiesene Filiale: Der Edge ist im Regelfall
  // Single-Location. Frueher haing dieser Zweig an `system.mode ===
  // 'standalone'`; das haette bei einer abgeleiteten Modus-Angabe auf gepairten
  // Edges jede Bestellung mit LOCATION_NOT_ASSIGNED abgewiesen.
  //
  // `$sort` ist der eigentliche Punkt: ohne ihn liefert SQLite eine formal
  // beliebige Zeile, die Zuordnung waere also nicht reproduzierbar. Mit Sortierung
  // faellt bei mehreren Locations immer dieselbe — nachvollziehbar statt zufaellig.
  //
  // Mehrere Locations werden bewusst NICHT abgelehnt: eine stehende Kasse ist
  // operativ schlimmer als eine eindeutige, aber moeglicherweise ungewollte
  // Zuordnung. Der Fall ist auffaellig genug fuer ein Wide-Event, damit er im
  // Support sichtbar wird, statt still zu bleiben.
  const locations = (await app.service('locations').find({
    query: { $limit: 2, $sort: { _id: 1 }, $select: ['_id'] },
    provider: undefined,
  })) as any
  const candidates = (locations.data ?? []) as Array<{ _id: string }>
  if (candidates.length === 0) {
    throw new BadRequest(AppErrorMessages[AppError.LOCATION_NOT_ASSIGNED], {
      code: AppError.LOCATION_NOT_ASSIGNED,
    })
  }

  const total = typeof locations.total === 'number' ? locations.total : candidates.length
  if (total > 1) {
    logger.warn({
      message:
        'Bestellung ohne activeLocationId auf einem Edge mit mehreren Locations — ' +
        'erste Location nach _id-Sortierung zugeordnet. activeLocationId am User setzen.',
      event: 'order.location_fallback_ambiguous',
      userId: user._id,
      locationCount: total,
      chosenLocationId: candidates[0]._id,
    })
  }

  return candidates[0]._id
}

/**
 * Schwelle des Standorts, sonst Config, sonst Hauskonstante — identische
 * Aufloesung wie cloud-seitig (`restrict-order-to-business-day.hook.ts`).
 */
function resolveMaxOpenHours(app: HookContext['app'], location: Location): number {
  const configured = app.get('maxBusinessDayOpenHours')
  const fallback = typeof configured === 'number' && configured > 0 ? configured : DEFAULT_MAX_OPEN_HOURS

  const override = location.settings?.businessDaySettings?.maxOpenHours
  return typeof override === 'number' && Number.isFinite(override) && override > 0 ? override : fallback
}

/**
 * Laufzeit des Geschaeftstags in Stunden seit `openedAt`.
 *
 * `null`, wenn kein brauchbarer Zeitstempel vorliegt — dann wird die
 * Altersgrenze uebersprungen statt zu sperren. Ein falsch-positiver Blocker
 * legt den Bestellbetrieb still, und ein `reopen` gibt es nicht
 * (Risiko-Asymmetrie aus panary-cloud ADR 0032). Eine Sperre soll aus dem
 * Betrieb kommen, nicht aus einem Datenfehler.
 */
async function loadOpenHours(
  app: HookContext['app'],
  businessDayId: string,
): Promise<{ openHours: number | null; operationMode?: string }> {
  const businessDay = (await app.service('businessdays').get(businessDayId, {
    query: { $select: ['openedAt', 'operationMode'] },
    provider: undefined,
  })) as { openedAt?: string; operationMode?: string }

  if (!businessDay.openedAt) return { openHours: null, operationMode: businessDay.operationMode }

  const openHours = getHoursSince(businessDay.openedAt)
  return {
    openHours: Number.isFinite(openHours) ? openHours : null,
    operationMode: businessDay.operationMode,
  }
}

/**
 * Vokabular nach panary-cloud ADR 0037: im Bestellbetrieb (`orders-only`) gibt
 * es keinen „Tagesabschluss" — der Begriff ist im Gastro-Sprachgebrauch synonym
 * mit Z-Abschluss, den der Modus gerade nicht erzeugt.
 */
function closingWording(operationMode: string | undefined): string {
  return operationMode === 'orders-only'
    ? 'den Betriebstag beenden und einen neuen eroeffnen'
    : 'den Tagesabschluss durchfuehren und einen neuen Geschaeftstag eroeffnen'
}

/**
 * Verweigert neue Bestellungen, wenn der offene Geschaeftstag laenger als die
 * Schwelle offen ist — gemessen **ab `openedAt`**, nicht als Kalendertags-
 * Differenz.
 *
 * Bis 2026-08-10 sperrte der gepairte Betrieb stattdessen bei
 * `currentBusinessDay.date !== today`, mit `today` aus `toISOString()` — also
 * **UTC**, waehrend die Cloud den Geschaeftstag in Filial-Lokalzeit stempelt.
 * In CEST sprang die Sperre damit um 02:00 Ortszeit: Ein gepairter Edge konnte
 * keinen Geschaeftstag ueber Mitternacht betreiben. Begruendung und gemeinsame
 * Regel fuer beide Repos: panary-cloud ADR 0047.
 */
async function ensureBusinessDayNotOpenTooLong(
  app: HookContext['app'],
  location: Location,
  businessDayId: string,
  errorCode: string,
  message: (openHours: number, maxOpenHours: number, operationMode?: string) => string,
): Promise<void> {
  const maxOpenHours = resolveMaxOpenHours(app, location)
  const { openHours, operationMode } = await loadOpenHours(app, businessDayId)

  if (openHours === null) {
    logger.warn({
      message: 'Order-Gate: Geschaeftstag ohne brauchbaren Zeitstempel — Altersgrenze uebersprungen',
      event: 'business_day.age_check_skipped',
      locationId: location._id,
      businessDayId,
    })
    return
  }

  if (openHours > maxOpenHours) {
    throw new BadRequest(message(Math.floor(openHours), maxOpenHours, operationMode), {
      code: errorCode,
      openHours: Math.floor(openHours),
      maxAllowedOpenHours: maxOpenHours,
    })
  }
}

/**
 * Hook: Ordnet jeder neuen Bestellung einen gueltigen Geschaeftstag zu.
 *
 * Ohne CONNECTED-Pairing (bzw. mit aktivem Offline-Override): Erstellt bei
 * Bedarf automatisch einen neuen Geschaeftstag (Auto-Rotate).
 * Mit CONNECTED-Pairing: Erwartet einen von der Cloud gepflegten Geschaeftstag
 * und validiert dessen Alter.
 */
export function restrictOrderToBusinessDay() {
  return async (context: HookContext) => {
    const { app } = context

    const locationId = await resolveLocationId(context)

    // Ohne `$select`: Der Standort-Override der Altersgrenze liegt in
    // `settings`, und `settings` steht **nicht** in `locationQueryProperties`
    // — `querySyntax` leitet die erlaubten `$select`-Werte daraus ab, ein
    // `$select: [… , 'settings']` scheitert also am Query-Validator mit
    // „validation failed". Ein voller Primaerschluessel-Read ist billiger als
    // ein zweiter Service-Call, und derselbe Weg, den
    // `restrict-order-to-cash-session.ts` auf diesem Pfad schon geht.
    const activeLocation: Location = await app.service('locations').get(locationId, {
      provider: undefined,
    })

    // `today` steuert ausschliesslich die **Rotation** — dort ist der
    // Kalendertag die richtige Groesse (ein neuer Tag bekommt einen neuen
    // Geschaeftstag). Die **Sperre** haengt seit ADR 0047 nicht mehr daran,
    // sondern an der Laufzeit seit `openedAt`.
    const today = new Date().toISOString().slice(0, 10)
    const needsRotation = shouldAutoRotate(activeLocation.currentBusinessDay, today)

    // Im Cloud-Managed-Hybrid (siehe ADR business-days-cloud-managed):
    // `rotateBusinessDay()` darf nur laufen, wenn KEIN aktives Pairing besteht
    // ODER der Operator den Offline-Override gesetzt hat (manueller Bypass bei
    // Cloud-Outage). Sonst blockieren.
    //
    // Der Pairing-Zustand ist hier die alleinige Wahrheit — `system.mode` ist
    // eine Reporting-Angabe und wird bewusst NICHT mehr geprueft (identische
    // Regel wie `isLocalRotationAllowed()` im Boot-Pfad).
    const cloudConnection = await getConnectedCloudConnection(context)
    const overrideActive = cloudConnection ? isOfflineOverrideActive(cloudConnection) : false
    const localRotationAllowed = !cloudConnection || overrideActive

    if (needsRotation && localRotationAllowed) {
      // Rotation blockieren wenn noch aktive Bestellungen vorhanden
      if (activeLocation.currentBusinessDay?.businessDayId) {
        const blocked = await hasActiveOrders(app, activeLocation.currentBusinessDay.businessDayId)

        if (blocked) {
          // Rotation durch offene Bestellungen blockiert: Bevor wir die neue
          // Order still dem veralteten Tag zuordnen, pruefen wir das Tages-Alter
          // seit Oeffnung. Ist die Schwelle ueberschritten, wird die Bestellung
          // verweigert — der Operator muss die offenen Bestellungen abschliessen.
          //
          // Eigener Fehlercode: Die noetige Handlung ist hier eine andere als
          // beim reinen Ueberschreiten der Altersgrenze — erst die offenen
          // Bestellungen abschliessen, dann rotiert der Tag von selbst.
          await ensureBusinessDayNotOpenTooLong(
            app,
            activeLocation,
            activeLocation.currentBusinessDay.businessDayId,
            AppError.BUSINESS_DAY_OPEN_TOO_LONG,
            () => AppErrorMessages[AppError.BUSINESS_DAY_OPEN_TOO_LONG],
          )

          logger.warn(
            `[AutoBusinessDay] Rotation fuer Location ${locationId} blockiert — aktive Bestellung(en) im Geschaeftstag ${activeLocation.currentBusinessDay.businessDayId}. Neue Bestellung wird dem aktuellen Geschaeftstag zugeordnet.`,
          )
          context.data.businessDayId = activeLocation.currentBusinessDay.businessDayId
          return context
        }
      }

      const newId = await rotateBusinessDay(app, activeLocation, today)
      context.data.businessDayId = newId
      return context
    }

    // Ab hier: CONNECTED ohne Override (Cloud ist Master fuer den Lifecycle)
    // oder schlicht kein Rotationsbedarf. In beiden Faellen muss ein
    // Geschaeftstag existieren.
    //
    // Frueher stand hier ein zweiter Zweig, der bei `needsRotation` sofort warf
    // — also sobald `currentBusinessDay.date !== today`. Das war die
    // eigentliche Sperre im gepairten Betrieb, ohne jede Toleranz und in UTC
    // gerechnet. Sie faellt ersatzlos weg: Ein veraltetes **Datum** ist kein
    // Grund mehr, ein zu langer **Betrieb** schon (ADR 0047).
    if (!activeLocation.currentBusinessDay) {
      throw new BadRequest(
        cloudConnection && !overrideActive
          ? 'Der aktuelle Geschaeftstag wird in der Cloud verwaltet und ist nicht eroeffnet. ' +
              'Bitte im Cloud-Admin einen neuen Geschaeftstag eroeffnen — oder im Edge-Admin ' +
              'den Offline-Modus aktivieren (bei Cloud-Outage).'
          : AppErrorMessages[AppError.BUSINESS_DAY_NOT_SET],
        { code: AppError.BUSINESS_DAY_NOT_SET },
      )
    }

    await ensureBusinessDayNotOpenTooLong(
      app,
      activeLocation,
      activeLocation.currentBusinessDay.businessDayId,
      AppError.BUSINESS_DAY_TOO_OLD,
      (openHours, maxOpenHours, operationMode) =>
        `Der Geschaeftstag vom ${activeLocation.currentBusinessDay?.date ?? '—'} ist seit ${openHours} ` +
        `Stunden offen (Grenze: ${maxOpenHours} Stunden). Bitte ${closingWording(operationMode)}.`,
    )

    context.data.businessDayId = activeLocation.currentBusinessDay.businessDayId
    return context
  }
}
