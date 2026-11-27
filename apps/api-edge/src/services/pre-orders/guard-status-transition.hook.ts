import { BadRequest } from '@feathersjs/errors'
import { type PreOrder, PreOrderStatus } from '@panary/pre-orders/domain'
import { assertCallerOwnsRecord } from '@panary/shared-backend'

import type { HookContext } from '../../declarations'

/**
 * Statusübergangs-Guard für EXTERNE `patch`-Aufrufe auf `pre-orders`
 * (panary/panary-core#1532, Parität zu panary/panary-cloud#2289).
 *
 * `preOrderPatchSchema` ist `Type.Partial(preOrderSchema)`: `status` und `convertedOrderId` sind
 * darüber frei patchbar, und die Statusprüfung stand bisher nur in `convert()`. Ein zurückgenommener
 * Storno, ein zweiter Storno oder eine wieder „offene" bereits konvertierte Vorbestellung, deren Order
 * stehen bleibt, wurden angenommen. Das Domain-Schema bleibt unangetastet (sonst Pin-Bump in cloud);
 * die Regel gehört in den Request-Pfad.
 *
 * Gilt nur mit `params.provider`. Der Wechsel nach `converted` kommt aus `convert()` per internem
 * `patch(…, { provider: undefined })`, der Sync-Pull-Apply (`sync-apply.ts`) patcht ebenfalls intern
 * — beide laufen durch. Der POS-Outbox-Replay kennt für `pre-orders` nur `create`.
 *
 * Erlaubt extern: `pending → cancelled` und ein Patch, der den Status nicht ändert
 * (`pending → pending`, kein `status` im Body). Abgelehnt (400):
 *  - jedes externe Setzen von `convertedOrderId` oder `status: converted`,
 *  - jeder Statuswechsel aus `cancelled`/`converted` heraus, auch auf denselben Wert,
 *  - ein Patch ohne `id` (Bulk) mit `status`: Der Übergang ließe sich nicht je Zeile prüfen.
 *
 * Reihenfolge: läuft in `before.patch` NACH `validateData`/`resolveData`; `multiTenancy` (around) hat
 * `params.query` zu diesem Zeitpunkt schon auf Mandant und Filiale des Aufrufers gescopt. Der Vorab-Read
 * übernimmt genau diesen Scope: Eine fremde `_id` antwortet wie eine fehlende mit 404 und verrät weder
 * Existenz noch Status. `assertCallerOwnsRecord` bleibt als zweite Schicht.
 */
export const guardPreOrderStatusTransition = async (context: HookContext): Promise<HookContext> => {
  if (!context.params?.provider) return context

  const data = (context.data ?? {}) as { status?: string; convertedOrderId?: unknown }

  if (data.convertedOrderId !== undefined) {
    throw new BadRequest('Die verknüpfte Bestellung einer Vorbestellung kann nicht direkt gesetzt werden.')
  }
  if (data.status === undefined) return context

  if (data.status === PreOrderStatus.CONVERTED) {
    throw new BadRequest('Eine Vorbestellung wird nur über die Konvertierung zur Bestellung.')
  }
  if (context.id === null || context.id === undefined) {
    throw new BadRequest('Der Status von Vorbestellungen kann nur einzeln geändert werden.')
  }

  // Scope des Aufrufers aus der von `multiTenancy` vorbereiteten Query übernehmen (nur die Scope-Felder).
  const { tenantId, locationId, $or } = (context.params.query ?? {}) as Record<string, unknown>
  const scope: Record<string, unknown> = {}
  if (tenantId !== undefined) scope['tenantId'] = tenantId
  if (locationId !== undefined) scope['locationId'] = locationId
  if ($or !== undefined) scope['$or'] = $or

  const current = (await context.app
    .service('pre-orders')
    .get(String(context.id), { provider: undefined, query: scope })) as PreOrder
  assertCallerOwnsRecord(context.params.user, current)

  if (current.status === PreOrderStatus.CONVERTED) {
    throw new BadRequest('Diese Vorbestellung wurde bereits konvertiert.')
  }
  if (current.status === PreOrderStatus.CANCELLED) {
    throw new BadRequest('Eine stornierte Vorbestellung kann nicht mehr geändert werden.')
  }

  return context
}
