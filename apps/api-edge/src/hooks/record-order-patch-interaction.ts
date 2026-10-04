import { HookContext } from '@feathersjs/feathers'
import { OrderInteractionType } from '@panary/order-interactions/domain'
import { OrderStatus } from '@panary/orders/domain'
import { logger } from '@panary/shared-backend'

/** Praefix des virtuellen Geraete-Users aus `allow-apikey.hook.ts`. */
const DEVICE_USER_ID_PREFIX = 'device:'

/**
 * After-Patch-Hook: schreibt ein Journal-Ereignis fuer Aenderungen NACH der
 * Bestellannahme (panary/panary-core#348).
 *
 * Bis hierher erfasste das Journal nur, was VOR dem Absenden passierte: Der
 * POS sammelt Interaktionen im Dialog, sie reisen als `orderInteractions` im
 * `create` mit (`extractOrderInteractions` → `createOrderInteractions`). Einen
 * `after.patch`-Pfad gab es nicht — fuer Storno, Split und Nachbuchung also
 * keinen Protokollierungspfad.
 *
 * Erster Nutzer ist der **Storno**: Er existiert bereits und ist damit ein
 * realer Beleg fuer den Pfad, bevor der Split ihn benutzt (#349).
 *
 * 🚨 Ohne Bediener KEIN Eintrag. `orderInteractionSchema.userId` ist Pflicht,
 * und das zu Recht: Ein Journal-Ereignis ohne „wer" beantwortet die einzige
 * Frage nicht, fuer die es existiert. Interne Aufrufe ohne `params.user`
 * (Worker, Seeds, Sync-Apply) schreiben deshalb nichts — das ist Absicht und
 * kein Verlust, denn dort gibt es keinen Bediener zu protokollieren.
 *
 * 🚨 Geraete-Sessions (POS) schreiben hier ebenfalls nichts: `params.user._id`
 * ist dort `device:<uuid>`. Das Ereignis entsteht im Storno-Dialog des POS
 * (`cancel-order-dialog.component.ts`, panary/panary-core#591). Dieser Hook
 * deckt nur JWT-Sessions ab.
 *
 * 🚨 Nicht blockierend, wie `createOrderInteractions` und die TSE-Hooks
 * (§146a): Ein fehlgeschlagener Journal-Schreibvorgang darf den Storno nicht
 * scheitern lassen. Der Audit-Pfad nimmt Verlust bewusst in Kauf, statt den
 * Geschaeftspfad zu blockieren — ein fehlendes Ereignis faellt im Betrieb
 * **nicht** auf, deshalb ein eigenes `event`-Feld im Log.
 */
export function recordOrderPatchInteraction() {
  return async (context: HookContext) => {
    const { app, data, result, params } = context

    const patchedStatus = (data as { status?: string } | undefined)?.status
    if (patchedStatus !== OrderStatus.ABORTED) return context

    const userId = (params.user as { _id?: string } | undefined)?._id
    if (!userId) return context
    // Am POS ist `params.user` der virtuelle Geraete-User aus `allowApiKey`, kein
    // Mensch und kein UUID — ein Eintrag scheiterte still an `format: uuid`
    // (panary/panary-core#591). Den Bediener kennt nur der POS; der Storno-Dialog
    // schreibt das Ereignis deshalb selbst, mit dem autorisierenden Manager.
    if (userId.startsWith(DEVICE_USER_ID_PREFIX)) return context

    const orders = Array.isArray(result) ? result : [result]

    for (const order of orders) {
      if (!order?._id) continue

      const lineItems = Array.isArray(order.lineItems) ? order.lineItems : []

      try {
        await app.service('order-interactions').create(
          {
            type: OrderInteractionType.ORDER_CANCEL,
            orderId: order._id,
            userId,
            businessDayId: order.businessDayId,
            eventAt: new Date().toISOString(),
            orderOpenedAt: order.recordingDate || order.createdAt,
            hadLineItems: lineItems.length > 0,
            lineItemCountAtCancel: lineItems.length,
            totalQuantityAtCancel: lineItems.reduce(
              (sum: number, item: { amount?: number }) => sum + (item.amount ?? 0),
              0,
            ),
            // tenantId/locationId explizit: Der Aufruf laeuft intern, damit er
            // nicht an der Rollenpruefung des Aufrufers haengt; `multiTenancy()`
            // stempelt dann nicht.
            tenantId: order.tenantId,
            locationId: order.locationId,
          },
          { provider: undefined },
        )
      } catch (error) {
        logger.error({
          message: 'Journal-Ereignis zum Storno konnte nicht angelegt werden',
          event: 'order.patch_interaction_failed',
          orderId: order._id,
          tenantId: order.tenantId,
          error,
        })
      }
    }

    return context
  }
}
