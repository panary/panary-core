import { BadRequest } from '@feathersjs/errors'
import { logger } from '@panary/shared-backend'
import { BusinessDayStatus } from '@panary/businessdays/domain'

import type { HookContext } from '../declarations'

interface BusinessDayCreateData {
  tenantId?: string | null
  locationId?: string | null
  status?: string
}

/**
 * Verhindert, dass fuer eine Filiale ein zweiter Geschaeftstag eroeffnet wird,
 * solange dort noch einer offen ist.
 *
 * Warum als Hook und nicht nur in `openDay()`: die Pruefung lebte ausschliesslich
 * in `openDay()` (business-days.ts). `rotateBusinessDay` ruft `create` direkt auf
 * und umging sie damit — das war die Ursache fuer mehrere gleichzeitig offene
 * Tage pro Filiale. `rotateBusinessDay` schliesst inzwischen alle offenen Tage
 * vorher, im Normalpfad feuert dieser Guard also nie. Er ist das Netz fuer jeden
 * kuenftigen Aufrufer, der `openDay()` erneut umgeht.
 *
 * Ausnahmen:
 *  - `params.fromSync`: die Cloud ist Source-of-Truth. Sie darf einen Tag pushen,
 *    den der Edge fuer ueberlappend haelt — sonst wuerde der Pull-Worker
 *    dauerhaft rejecten (geteilte Schema-/Guard-Constraints killen Sync terminal).
 *  - Records ohne `locationId`: die Eindeutigkeit ist per Filiale definiert.
 *  - Records, die nicht offen angelegt werden (Sync-Nachzuegler, Reparaturen).
 *
 * Fail-open bei Lookup-Fehlern: ein transienter DB-Fehler darf die Boot-Rotation
 * nicht blockieren (kein Geschaeftstag = keine Bestellungen). Muster analog
 * `guardCloudManagedLifecycle`.
 */
export const ensureSingleOpenBusinessDay = async (context: HookContext): Promise<HookContext> => {
  if ((context.params as { fromSync?: boolean })?.fromSync) return context

  const records: BusinessDayCreateData[] = Array.isArray(context.data)
    ? (context.data as BusinessDayCreateData[])
    : [context.data as BusinessDayCreateData]

  for (const record of records) {
    if (!record?.locationId || !record.tenantId) continue
    // Der Create-Resolver erzwingt status=OPEN; bei fromSync sind wir schon raus.
    // Ein explizit nicht-offener Record kann keine zweite Eroeffnung sein.
    if (record.status && record.status !== BusinessDayStatus.OPEN) continue

    let openCount = 0
    try {
      const existing = await context.app.service('businessdays').find({
        query: {
          tenantId: record.tenantId,
          locationId: record.locationId,
          status: BusinessDayStatus.OPEN,
          $limit: 1,
        },
        provider: undefined,
      } as never)
      const items = Array.isArray(existing) ? existing : ((existing as { data?: unknown[] })?.data ?? [])
      openCount = items.length
    } catch (err) {
      logger.warn({
        message: 'ensureSingleOpenBusinessDay: Lookup fehlgeschlagen, fail-open',
        event: 'business_day.single_open_guard_failed',
        tenantId: record.tenantId,
        locationId: record.locationId,
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      continue
    }

    if (openCount > 0) {
      logger.warn({
        message: 'Zweite Geschaeftstag-Eroeffnung bei bereits offenem Tag abgelehnt',
        event: 'business_day.duplicate_open_rejected',
        tenantId: record.tenantId,
        locationId: record.locationId,
      })
      throw new BadRequest(`Es ist bereits ein Geschaeftstag fuer Location ${record.locationId} offen`)
    }
  }

  return context
}
