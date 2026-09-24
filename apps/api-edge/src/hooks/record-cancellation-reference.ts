import { HookContext } from '@feathersjs/feathers'
import { OrderReferenceType } from '@panary/order-references/domain'
import { OrderStatus } from '@panary/orders/domain'
import { logger } from '@panary/shared-backend'

/**
 * After-Patch-Hook: schreibt beim Storno eine Vorgangs-Referenz.
 *
 * DSFinV-K Tz. 4.2.2 verlangt fuer jeden Bezug auf einen urspruenglichen Vorgang
 * einen Datensatz in `Bon_Referenzen`. Der Storno ist der erste Nutzer dieses
 * Pfades — Split und Umbuchung folgen mit panary/panary-core#349.
 *
 * `targetOrderId` bleibt bewusst LEER: Ein Storno legt keinen neuen Vorgang an,
 * er setzt den bestehenden auf ABORTED. Ein Selbstverweis waere eine Aussage
 * ueber die Datenlage, die nicht stimmt.
 *
 * 🚨 Nicht blockierend — bewusst, konsistent zu den TSE-Hooks (§146a): Ein
 * fehlgeschlagener Referenz-Schreibvorgang darf den Storno nicht scheitern
 * lassen und damit die Kasse sperren. Der Preis ist, dass ein Fehler nur im Log
 * steht; deshalb loggt der catch-Zweig mit eigenem `event`-Feld, auf das sich
 * eine Auswertung stuetzen kann.
 */
export function recordCancellationReference() {
  return async (context: HookContext) => {
    const { app, data, result } = context

    // Nur beim Uebergang auf ABORTED. `data` ist der Patch-Body: Ein Patch, der
    // den Status nicht anfasst, geht uns nichts an.
    const patchedStatus = (data as { status?: string } | undefined)?.status
    if (patchedStatus !== OrderStatus.ABORTED) return context

    // Multi-Patch liefert ein Array. Der orders-Service laesst das per
    // `checkMultiOperation` normalerweise nicht zu; defensiv behandeln wir beide.
    const orders = Array.isArray(result) ? result : [result]

    for (const order of orders) {
      if (!order?._id) continue

      try {
        await app.service('order-references').create(
          {
            refType: OrderReferenceType.STORNO,
            sourceOrderId: order._id,
            // targetOrderId: bewusst nicht gesetzt (siehe Kopfkommentar).
            refDate: order.recordingDate || order.createdAt || new Date().toISOString(),
            refLocationId: order.locationId,
            refBusinessDayId: order.businessDayId,
            // tenantId/locationId explizit: der interne Aufruf laeuft ohne
            // `provider`, damit `blockExternalWrites` ihn durchlaesst — dabei
            // stempelt `multiTenancy()` nichts, weil kein externer Kontext
            // vorliegt. Ohne diese beiden Felder schluege der Insert an den
            // notNullable-Spalten fehl.
            tenantId: order.tenantId,
            locationId: order.locationId,
          },
          { provider: undefined },
        )
      } catch (error) {
        logger.error({
          message: 'Vorgangs-Referenz zum Storno konnte nicht angelegt werden',
          event: 'order.cancellation_reference_failed',
          orderId: order._id,
          tenantId: order.tenantId,
          error,
        })
      }
    }

    return context
  }
}
