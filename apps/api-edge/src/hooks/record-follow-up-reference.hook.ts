import { HookContext } from '@feathersjs/feathers'
import { OrderReferenceType } from '@panary/order-references/domain'
import { isSyntheticSettlementScope } from '@panary/orders/domain'
import { logger } from '@panary/shared-backend'

type CircleOrder = {
  _id: string
  recordingDate?: string | null
  createdAt?: string | null
  locationId?: string | null
  businessDayId?: string | null
}

/**
 * After-Create-Hook: Vorgangs-Referenz einer Nachbestellung (ADR 0063 Nr. 1, core#1140).
 *
 * Eine Nachbestellung ist eine neue Bestellung im Kreis des Tisches. Sie bekommt eine
 * Referenz `Transaktion` auf die **erste** Bestellung des Kreises: Der Bezug ist dann
 * fuer jede Nachbestellung derselbe und ohne Kette nachvollziehbar.
 *
 * Erkannt wird sie am Kreis, nicht an einem Merkmal, das die Kasse mitschickt: Hat der
 * Kreis der neuen Bestellung schon eine fruehere Bestellung, ist sie eine Nachbestellung.
 * So zaehlt auch eine Bestellung, die eine Kasse ohne Verbindung aufgenommen hat, oder
 * eine, bei der der Bediener den Tisch von Hand gewaehlt hat — fachlich derselbe Vorgang.
 * Ein eigenes Feld an `orders` wuerde mit jedem Push zur Cloud reisen, die es bis zum
 * Pin-Bump TERMINAL ablehnt (ADR 0047, „Release-Reihenfolge").
 *
 * Nicht beruecksichtigt:
 * - der Split (`params.inheritSettlementScope`): Er legt ebenfalls eine weitere Bestellung
 *   im Kreis an, traegt aber schon seine Referenz `Split` (ADR 0049).
 * - per Sync angekommene Bestellungen (`params.fromSync`): Ihre Referenz hat der Edge
 *   geschrieben, der sie angelegt hat, und sie reist selbst per Sync.
 * - synthetische Kreise: Sie gehoeren zu genau einer Bestellung.
 *
 * 🚨 Awaited und nicht blockierend, wie Storno- und Split-Referenz (ADR 0048): Der POS
 * fordert direkt nach dem Anlegen den Bon an (`/print-order`), und der liest die Referenz.
 * Ein Fehler darf die Bestellung nicht scheitern lassen, er steht im Log mit eigenem `event`.
 */
export function recordFollowUpReference() {
  return async (context: HookContext) => {
    const params = context.params as { inheritSettlementScope?: boolean; fromSync?: boolean }
    if (params.inheritSettlementScope === true || params.fromSync) return context

    const order = context.result as
      (CircleOrder & { tenantId?: string | null; settlementScope?: string | null }) | undefined
    if (!order?._id || Array.isArray(order)) return context

    const scope = order.settlementScope
    // Ohne Geschaeftstag (Standalone) waere ein Tisch-Kreis wie „4" nicht von dem des
    // Vortags zu trennen — lieber keine Referenz als eine auf den falschen Tag.
    if (!scope || isSyntheticSettlementScope(scope) || !order.businessDayId || !order.tenantId) return context

    try {
      const circle = (await context.app.service('orders').find({
        provider: undefined,
        paginate: false,
        query: {
          tenantId: order.tenantId,
          locationId: order.locationId,
          businessDayId: order.businessDayId,
          settlementScope: scope,
          $select: ['_id', 'recordingDate', 'createdAt', 'locationId', 'businessDayId'],
        },
      } as any)) as CircleOrder[]

      const first = firstOfCircle(Array.isArray(circle) ? circle : [])
      if (!first || first._id === order._id) return context

      await context.app.service('order-references').create(
        {
          refType: OrderReferenceType.TRANSAKTION,
          sourceOrderId: first._id,
          targetOrderId: order._id,
          refDate: first.recordingDate || first.createdAt || new Date().toISOString(),
          refLocationId: first.locationId,
          refBusinessDayId: first.businessDayId,
          // Explizit, wie bei der Storno-Referenz: Der interne Aufruf stempelt nichts.
          tenantId: order.tenantId,
          locationId: order.locationId,
        } as any,
        { provider: undefined },
      )
    } catch (error) {
      logger.error({
        message: 'Vorgangs-Referenz zur Nachbestellung konnte nicht angelegt werden',
        event: 'order.follow_up_reference_failed',
        orderId: order._id,
        settlementScope: scope,
        tenantId: order.tenantId,
        error,
      })
    }

    return context
  }
}

/**
 * Die erste Bestellung des Kreises: frueheste Aufnahme, bei Gleichstand die kleinere ID
 * (uuidv7 ist zeitlich sortiert). Eine offline aufgenommene, spaeter angekommene
 * Bestellung kann so selbst die erste sein — dann bekommt sie keine Referenz.
 */
export function firstOfCircle(orders: readonly CircleOrder[]): CircleOrder | null {
  let first: CircleOrder | null = null
  for (const candidate of orders) {
    if (!first || compare(candidate, first) < 0) first = candidate
  }
  return first
}

function compare(a: CircleOrder, b: CircleOrder): number {
  const at = Date.parse(a.recordingDate || a.createdAt || '')
  const bt = Date.parse(b.recordingDate || b.createdAt || '')
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) return at - bt
  if (Number.isFinite(at) !== Number.isFinite(bt)) return Number.isFinite(at) ? -1 : 1
  return a._id < b._id ? -1 : a._id > b._id ? 1 : 0
}
