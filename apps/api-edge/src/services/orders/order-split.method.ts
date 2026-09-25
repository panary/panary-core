import { BadRequest, Conflict } from '@feathersjs/errors'
import { OrderReferenceType } from '@panary/order-references/domain'
import { OrderInteractionType } from '@panary/order-interactions/domain'
import {
  OrderSplitError,
  OrderSplitErrorCode,
  PaymentState,
  type Order,
  type OrderSplitSelectionItem,
  planOrderSplit,
} from '@panary/orders/domain'
import { assertCallerOwnsRecord, logger } from '@panary/shared-backend'
import { uuidv7 } from 'uuidv7'
import type { Application } from '../../declarations'

/**
 * `orders.split` — eine offene Bestellung in eine Teilbestellung aufteilen
 * („getrennt zahlen", panary/panary-core#349).
 *
 * Ein Aufruf erzeugt GENAU EINE Zielbestellung. Wer auf drei Belege aufteilen
 * will, ruft zweimal: `splitOff` ist append-only und `effectiveLineItems()`
 * summiert die Gegenbuchungen. Der Rundungsrest (A14) waere bei mehreren Zielen
 * in einem Aufruf nicht mehr einem Vorgang zuzuordnen.
 *
 * 🚨 Eine Custom Method laeuft an den Schutzschichten des CRUD-Pfades vorbei.
 * `multiTenancy()` schaltet nur auf CRUD-Methodennamen und ist hier ein No-Op,
 * der innere `get` laeuft mit `{ provider: undefined }` und ist damit
 * ungescoped, und `ensureTenantIsolation` ist ein App-Level-*after*-Hook — er
 * prueft das Ergebnis, also nach dem Write. Deshalb `assertCallerOwnsRecord`
 * (ADR 0046) UNMITTELBAR nach dem `get` und VOR jeder Zustandsmeldung: Sonst
 * verraten die Vorbedingungs-Ablehnungen („bereits abgeschlossen") den Zustand
 * fremder Datensaetze.
 *
 * 🚨 Der Split ist der EINZIGE Schreibpfad auf `splitOff`. Der
 * `orderPatchResolver` strippt das Feld fuer jeden anderen Aufruf — ein Client,
 * der es selbst setzen koennte, senkte die ausgewiesene Steuer seiner eigenen
 * Bestellung. Die Freigabe haengt an `params.provider === undefined` UND
 * `params.orderSplit === true`; `params` baut der Server, ein externer Aufrufer
 * erreicht sie nicht.
 */
export interface OrderSplitRequest {
  /** Quellbestellung. */
  orderId: string
  /** Welche Zeilen in welcher Menge wandern. Menge weglassen = ganze Zeile. */
  lineItems: OrderSplitSelectionItem[]
}

export interface OrderSplitResult {
  sourceOrder: Order
  targetOrder: Order
}

/** Domain-Fehlercodes auf HTTP-Fehler abbilden — die Ablehnung muss sprechend sein, nicht still. */
function toFeathersError(error: OrderSplitError): Error {
  const data = { code: error.code }
  switch (error.code) {
    case OrderSplitErrorCode.SOURCE_NOT_SPLITTABLE:
    // Zustand der Quelle, nicht Form der Anfrage — wie ein abgeschlossener Vorgang (#394).
    case OrderSplitErrorCode.SOURCE_ALREADY_PAID:
    case OrderSplitErrorCode.NOTHING_REMAINS:
      return new Conflict(error.message, data)
    default:
      return new BadRequest(error.message, data)
  }
}

export function createOrderSplitMethod(app: Application) {
  return async (data: OrderSplitRequest, params?: any): Promise<OrderSplitResult> => {
    if (!data || typeof data !== 'object' || typeof data.orderId !== 'string') {
      throw new BadRequest('Es fehlt die `orderId` der zu splittenden Bestellung.')
    }

    const source = (await app.service('orders').get(data.orderId, { provider: undefined })) as Order

    // 🚨 Vor jeder Zustandsmeldung und vor jedem Write (ADR 0046). Feathers
    // rollt nichts zurueck: Ein Check nach `orders.create` liesse die
    // Zielbestellung in der Datenbank stehen.
    assertCallerOwnsRecord(params?.user, source as unknown as { tenantId?: string })

    // A6 — ein ausgestellter Beleg schliesst den Vorgang. `issueReceipt` fuehrt
    // genau einen Beleg je Order; existiert er, ist der Vorgang fiskalisch
    // abgeschlossen, und es darf keinen Pfad geben, der ihn wieder oeffnet.
    const existingReceipts = (await app.service('receipts').find({
      query: { orderId: source._id, $limit: 0 },
      provider: undefined,
    })) as { total?: number } | unknown[]
    const receiptCount = Array.isArray(existingReceipts) ? existingReceipts.length : (existingReceipts.total ?? 0)
    if (receiptCount > 0) {
      throw new Conflict('Fuer diese Bestellung wurde bereits ein Beleg ausgestellt.', {
        code: OrderSplitErrorCode.SOURCE_NOT_SPLITTABLE,
      })
    }

    const targetOrderId = uuidv7()
    // A10 — eine Zeitquelle fuer den ganzen Vorgang. Die Zielbestellung bekommt
    // IHRE EIGENE Startzeit; nichts wird auf den Tischbeginn zurueckdatiert.
    const splitAt = new Date().toISOString()

    let plan
    try {
      plan = planOrderSplit(source, data.lineItems ?? [], { targetOrderId, splitAt, newId: () => uuidv7() })
    } catch (error) {
      if (error instanceof OrderSplitError) throw toFeathersError(error)
      throw error
    }

    // --- Zielbestellung anlegen ---
    // Ueber `create`, damit die volle Hook-Kette laeuft: `restrictOrderToBusinessDay()`
    // (Geschaeftstag inkl. Auto-Rotation), `assignDailySequenceNumber()` (eigene
    // Belegnummer je Teilbeleg), `assignSettlementScope()` (uebernimmt den
    // mitgeschickten Wert der Quelle — die Klammer muss identisch bleiben),
    // `signOrderTseStart` (im Kassenbetrieb ein EIGENER Vorgang; die Quelle wird
    // NICHT storniert) und `calculateTaxDetails`.
    const targetOrder = (await app.service('orders').create(
      {
        _id: targetOrderId,
        tenantId: source.tenantId,
        locationId: source.locationId,
        status: source.status,
        orderChannel: source.orderChannel,
        dineLocation: source.dineLocation,
        // Der Abrechnungskreis ist die Klammer ueber Bestellungen, Split-Belege,
        // Umbuchungen und Stornos (DSFinV-K Tz. 2.7.1) — er wird geerbt, nicht
        // neu abgeleitet.
        settlementScope: source.settlementScope,
        table: source.table ?? null,
        lineItems: plan.targetLineItems,
        appliedDiscounts: plan.targetAppliedDiscounts,
        // `taxSnapshot` schreibt `calculateTaxDetails` — bewusst EIN Schreiber.
        // Das Ergebnis ist mit `plan.targetTaxSnapshot` identisch, weil beide
        // dieselbe reine Funktion auf denselben Eingaben sind.
        isFinished: false,
        dailySequenceNumber: 0,
        estimatedDuration: 0,
        remainingTime: 0,
        // A10: eigene Vorgangs-Startzeit.
        recordingDate: splitAt,
        payment: { state: PaymentState.PENDING, totalAmount: 0, tipAmount: 0, transactions: [] },
      } as any,
      params,
    )) as Order

    // --- Quelle: Gegenbuchung anhaengen ---
    // 🚫 KEIN Schreibzugriff auf `lineItems` — die Sperre im `orderPatchResolver`
    // bleibt unangetastet (A5). Was der Vorgang noch traegt, ergibt sich aus
    // `splitOff`; `calculateTaxDetailsOnPatch` rechnet den Snapshot daraufhin neu.
    const sourceOrder = (await app.service('orders').patch(
      source._id,
      {
        splitOff: [...(source.splitOff ?? []), ...plan.splitOffEntries],
        appliedDiscounts: plan.sourceAppliedDiscounts,
        // A14 — der Rest wird aufsummiert, nicht ueberschrieben: Ein zweiter
        // Split traegt seinen eigenen bei.
        splitRoundingRemainderCents: (source.splitRoundingRemainderCents ?? 0) + plan.roundingRemainderCents,
      } as any,
      { ...params, provider: undefined, orderSplit: true },
    )) as Order

    await recordSplitReference(app, source, targetOrder)
    await recordSplitJournal(app, source, targetOrder, plan.splitOffEntries, params)

    logger.info({
      message: 'Bestellung gesplittet',
      event: 'order.split',
      orderId: source._id,
      targetOrderId: targetOrder._id,
      settlementScope: source.settlementScope,
      movedLines: plan.splitOffEntries.length,
      roundingRemainderCents: plan.roundingRemainderCents,
    })

    return { sourceOrder, targetOrder }
  }
}

/**
 * Vorgangs-Referenz (DSFinV-K `Bon_Referenzen`, Tz. 4.2.2).
 *
 * 🚨 Nicht blockierend — wie beim Storno (ADR 0048) und den TSE-Hooks (§ 146a):
 * Ein fehlgeschlagener Referenz-Schreibvorgang darf den Split nicht scheitern
 * lassen und damit die Kasse sperren. Der Preis ist bekannt: Ein Fehler steht
 * nur im Log, eine fehlende Referenz sieht in der Tabelle aus wie „gab es
 * nicht". Deshalb ein eigenes `event`-Feld, auf das sich eine Auswertung
 * stuetzen kann.
 */
async function recordSplitReference(app: Application, source: Order, target: Order): Promise<void> {
  try {
    await app.service('order-references').create(
      {
        refType: OrderReferenceType.SPLIT,
        sourceOrderId: source._id,
        // Anders als beim Storno IST hier ein Zielvorgang entstanden.
        targetOrderId: target._id,
        refDate: source.recordingDate || source.createdAt || new Date().toISOString(),
        refLocationId: source.locationId as string,
        refBusinessDayId: source.businessDayId,
        tenantId: source.tenantId,
        locationId: source.locationId,
      } as any,
      { provider: undefined },
    )
  } catch (error) {
    logger.error({
      message: 'Vorgangs-Referenz zum Split konnte nicht angelegt werden',
      event: 'order.split_reference_failed',
      orderId: source._id,
      targetOrderId: target._id,
      tenantId: source.tenantId,
      error,
    })
  }
}

/**
 * Journal-Ereignisse (panary/panary-core#348, Phase 5).
 *
 * 🚨 Ohne Bediener KEIN Eintrag: `orderInteractionSchema.userId` ist Pflicht,
 * und ein Journal-Ereignis ohne „wer" beantwortet die einzige Frage nicht, fuer
 * die es existiert. Interne Aufrufe ohne `params.user` schreiben deshalb
 * nichts — das ist Absicht, kein Verlust.
 *
 * Nicht blockierend, aus demselben Grund wie die Referenz oben.
 */
async function recordSplitJournal(
  app: Application,
  source: Order,
  target: Order,
  entries: ReadonlyArray<{ lineItemRowId: string; amount: number }>,
  params?: any,
): Promise<void> {
  const userId = params?.user?._id as string | undefined
  if (!userId) return

  const eventAt = new Date().toISOString()
  const base = {
    userId,
    businessDayId: source.businessDayId,
    eventAt,
    orderOpenedAt: source.recordingDate || source.createdAt,
    tenantId: source.tenantId,
    locationId: source.locationId,
  }

  const events: Record<string, unknown>[] = [
    { ...base, type: OrderInteractionType.ORDER_SPLIT, orderId: source._id },
    { ...base, type: OrderInteractionType.ORDER_SPLIT_TARGET, orderId: target._id },
    ...entries.map(entry => ({
      ...base,
      type: OrderInteractionType.ITEM_MOVED,
      orderId: source._id,
      // Die stabile Zeilen-ID, nicht der Array-Index (`lineItemId`) — nur sie
      // ueberlebt einen Split (ADR 0033, ADR 0048 Entscheidung 8).
      lineItemRowId: entry.lineItemRowId,
      deletedQuantity: entry.amount,
    })),
  ]

  for (const event of events) {
    try {
      await app.service('order-interactions').create(event as any, { provider: undefined })
    } catch (error) {
      logger.error({
        message: 'Journal-Ereignis zum Split konnte nicht angelegt werden',
        event: 'order.split_interaction_failed',
        orderId: source._id,
        interactionType: event['type'],
        tenantId: source.tenantId,
        error,
      })
    }
  }
}
