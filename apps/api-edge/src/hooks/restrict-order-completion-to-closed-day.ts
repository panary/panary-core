import type { HookContext } from '@feathersjs/feathers'
import { OrderStatus } from '@panary/orders/domain'

import {
  assertClosedDayApproved,
  loadClosedDayCheck,
  type ClosedDayGateLocation,
} from '../utils/closed-day-gate'

type LocationWithDay = ClosedDayGateLocation & { currentBusinessDay?: { businessDayId?: string } | null }

/**
 * Ruhetag-Gate beim Kassieren (panary/panary-core#1133, ADR 0062).
 *
 * Das Gate an der Anlage (`restrictOrderToBusinessDay`) erfasst keine Bestellung,
 * die schon vor dem Ruhetag offen war und erst heute abgeschlossen wird. Damit am
 * Ruhetag nichts ohne Freigabe kassiert wird, prüft dieser Hook den Übergang auf
 * `completed` gegen den **laufenden** Geschäftstag der Filiale — dort liegt die
 * Freigabe für heute, unabhängig davon, an welchem Tag die Bestellung angelegt wurde.
 *
 * Übersprungen: interne Aufrufe (Sync-Apply, Split), Patches ohne Statuswechsel auf
 * `completed` und schon abgeschlossene Bestellungen (idempotent).
 */
export function restrictOrderCompletionToClosedDay() {
  return async (context: HookContext) => {
    if (!context.params.provider) return context
    if (context.id == null) return context

    const data = context.data as { status?: string } | undefined
    if (!data || data.status !== OrderStatus.COMPLETED) return context

    let original: { status?: string; locationId?: string | null }
    try {
      original = (await context.service.get(context.id, { provider: undefined })) as typeof original
    } catch {
      return context
    }
    if (original.status === OrderStatus.COMPLETED) return context
    if (!original.locationId) return context

    const location = (await context.app
      .service('locations')
      .get(original.locationId, { provider: undefined })) as LocationWithDay

    const check = await loadClosedDayCheck(context.app, location)
    await assertClosedDayApproved(context.app, location, check, location.currentBusinessDay?.businessDayId)
    return context
  }
}
