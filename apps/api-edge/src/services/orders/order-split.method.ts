import { BadRequest, Conflict, GeneralError } from '@feathersjs/errors'
import { OrderReferenceType } from '@panary/order-references/domain'
import { OrderInteractionType } from '@panary/order-interactions/domain'
import {
  OrderSplitError,
  OrderSplitErrorCode,
  OrderStatus,
  PaymentState,
  type Order,
  type OrderSplitSelectionItem,
  planOrderSplit,
} from '@panary/orders/domain'
import { assertCallerOwnsRecord, logger } from '@panary/shared-backend'
import {
  FISCAL_GATE_BUSINESS_DAY_SELECT,
  resolveFiscalSignContext,
  type BusinessDayFiscalSnapshot,
} from '@panary/tse/domain'
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
  /**
   * Der am POS per PIN angemeldete Bediener — nur fuers Journal
   * (panary/panary-core#590). Am POS ist `params.user` der virtuelle
   * Geraete-User `device:<uuid>`, kein Mensch; Muster wie `performedBy` der
   * Bar-Transaktion (`restrictOrderToCashSession`).
   */
  performedBy?: string
}

export interface OrderSplitResult {
  sourceOrder: Order
  targetOrder: Order
}

/** Domain-Fehlercodes auf HTTP-Fehler abbilden — die Ablehnung muss sprechend sein, nicht still. */
function toFeathersError(error: OrderSplitError): Error {
  const data = { code: error.code }
  switch (error.code) {
    // Zustand der Quelle, nicht Form der Anfrage — eine bezahlte Quelle gehoert dazu (#394).
    case OrderSplitErrorCode.SOURCE_NOT_SPLITTABLE:
    case OrderSplitErrorCode.SOURCE_ALREADY_PAID:
    case OrderSplitErrorCode.NOTHING_REMAINS:
    case OrderSplitErrorCode.FISCAL_MODE_UNSUPPORTED:
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

    await assertOrdersOnlyBusinessDay(app, source)

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
    //
    // 🚨 Feathers rollt nichts zurueck (panary/panary-core#544): Scheitert dieser
    // Patch, steht das Ziel schon in der Datenbank, und dieselben Positionen
    // laegen auf zwei offenen Vorgaengen (A13, § 14c UStG). Deshalb faengt
    // `compensateFailedSourcePatch` den Fehler und storniert das Ziel.
    let sourceOrder: Order
    try {
      sourceOrder = (await app.service('orders').patch(
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
    } catch (patchError) {
      sourceOrder = await compensateFailedSourcePatch(app, source, targetOrder, patchError, params)
    }

    await recordSplitReference(app, source, targetOrder)
    await recordSplitJournal(app, source, targetOrder, plan.splitOffEntries, data.performedBy, params)

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
 * Kompensation, wenn nach angelegtem Ziel die Gegenbuchung der Quelle scheitert
 * (panary/panary-core#544). Ein Split ist danach entweder ganz oder gar nicht
 * passiert — oder, wenn auch das scheitert, als Teilerfolg ERKENNBAR.
 *
 * 1. **Gegenprobe:** Ein Fehler aus dem Patch heisst nicht, dass nichts
 *    geschrieben wurde — ein after-Hook kann nach dem Write werfen. Traegt die
 *    frisch gelesene Quelle schon die Gegenbuchung auf DIESES Ziel, ist der
 *    Split vollstaendig, und das Ziel zu stornieren liesse die Positionen von
 *    beiden Vorgaengen verschwinden. Dann zaehlt er als Erfolg.
 * 2. **Storno des Ziels** (`ABORTED`), nicht `remove`: Ein Kassenvorgang wird
 *    nicht geloescht (GoBD), seine Vorgangsnummer bleibt belegt statt einer
 *    Luecke, und die Outbox schickt einen gewoehnlichen Patch statt eines
 *    REMOVE an die Cloud. Der Storno legt ueber `recordCancellationReference`
 *    die Vorgangs-Referenz an. → `order-split/rolled-back`, nichts ist umgebucht.
 * 3. **Storno scheitert auch:** Teilerfolg, den der Edge nicht aufloesen kann.
 *    → `order-split/target-left-open` mit der Ziel-ID und ein eigenes Log-Event,
 *    damit der POS nicht zum Wiederholen einlaedt (ein zweiter Versuch buchte ein
 *    drittes Mal) und eine Auswertung den Fall findet.
 *
 * ⚠️ Der TSE-Start des Ziels wird hier nicht storniert: Der Split ist nur im
 * Bestellbetrieb freigegeben (`assertOrdersOnlyBusinessDay`), dort gibt es keinen.
 * Wer den Kassenbetrieb freischaltet (#351), muss diesen Pfad mitpruefen.
 */
async function compensateFailedSourcePatch(
  app: Application,
  source: Order,
  target: Order,
  patchError: unknown,
  params?: any,
): Promise<Order> {
  const internal = { ...params, provider: undefined }

  try {
    const current = (await app.service('orders').get(source._id, { provider: undefined })) as Order
    if ((current.splitOff ?? []).some(entry => entry.targetOrderId === target._id)) {
      logger.warn({
        message: 'Gegenbuchung zum Split meldete einen Fehler, ist aber geschrieben',
        event: 'order.split_source_patch_error_after_write',
        orderId: source._id,
        targetOrderId: target._id,
        tenantId: source.tenantId,
        error: patchError,
      })
      return current
    }
  } catch {
    // Nicht lesbar: weiter mit dem Storno. Die Gegenprobe ist eine Absicherung,
    // ihr Ausfall darf die Kompensation nicht verhindern.
  }

  const failure = {
    orderId: source._id,
    targetOrderId: target._id,
    targetSequenceNumber: target.dailySequenceNumber,
    tenantId: source.tenantId,
  }

  try {
    await app.service('orders').patch(target._id, { status: OrderStatus.ABORTED } as any, internal)
  } catch (abortError) {
    logger.error({
      message: 'Split-Teilerfolg: Zielbestellung angelegt, Quelle nicht gegengebucht, Storno des Ziels gescheitert',
      event: 'order.split_target_left_open',
      ...failure,
      error: patchError,
      abortError,
    })
    throw new GeneralError(
      'Die Teilbestellung wurde angelegt, die Ursprungsbestellung aber nicht angepasst. Nicht erneut aufteilen.',
      {
        code: OrderSplitErrorCode.TARGET_LEFT_OPEN,
        targetOrderId: target._id,
        targetSequenceNumber: target.dailySequenceNumber,
      },
    )
  }

  logger.error({
    message: 'Split zurueckgenommen: Quelle nicht gegengebucht, Zielbestellung storniert',
    event: 'order.split_rolled_back',
    ...failure,
    error: patchError,
  })
  throw new GeneralError('Die Bestellung wurde nicht aufgeteilt; die angelegte Teilbestellung ist storniert.', {
    code: OrderSplitErrorCode.ROLLED_BACK,
    targetOrderId: target._id,
    targetSequenceNumber: target.dailySequenceNumber,
  })
}

/**
 * Freigabe nur im Bestellbetrieb (panary/panary-core#350).
 *
 * Im Kassenbetrieb startet `signOrderTseStart` fuer die Zielbestellung einen
 * eigenen TSE-Vorgang. Dieser Pfad ist gegen keine echte TSE verifiziert
 * (panary/panary-core#351) — bis dahin lehnt der Edge ab. Das Ausblenden des
 * Einstiegs im POS ist KEINE Zugangskontrolle: Diese Pruefung ist es.
 *
 * 🚨 Die Zielbestellung landet NICHT auf dem Geschaeftstag der Quelle:
 * `restrictOrderToBusinessDay()` gibt ihr den AKTUELLEN Tag der Filiale und
 * eroeffnet beim Anlegen notfalls einen neuen (Auto-Rotation), dessen Modus aus
 * der aktuellen `operationMode` der Filiale kommt. Nach dem Modus genau dieses
 * Tages entscheidet `signOrderTseStart`. Weil vor dem `create` nicht feststeht,
 * welcher der Faelle eintritt, muessen ALLE Kandidaten definitiv `orders-only`
 * sein: der Tag der Quelle, der aktuelle Tag der Filiale und die Filiale selbst.
 * Die Tage gehen ueber `resolveFiscalSignContext` — dieselbe Entscheidung samt
 * fail-safe-Richtung wie der Hook: Fehlt ein Tag oder ist er nicht lesbar, gilt
 * er als signierpflichtig, und es wird abgelehnt. Ebenso eine nicht ladbare
 * Filiale.
 *
 * Steht VOR der Beleg-Abfrage und vor jedem Write, aber NACH dem Eigentums-Check:
 * Die Ablehnung verraet sonst den Modus fremder Filialen.
 */
async function assertOrdersOnlyBusinessDay(app: Application, source: Order): Promise<void> {
  const reject = (): never => {
    throw toFeathersError(
      new OrderSplitError(
        OrderSplitErrorCode.FISCAL_MODE_UNSUPPORTED,
        'Bestellungen aufteilen ist derzeit nur im Bestellbetrieb moeglich, nicht im Kassenbetrieb.',
      ),
    )
  }

  let location: { operationMode?: string; currentBusinessDay?: { businessDayId?: string } | null } | undefined
  try {
    location = source.locationId
      ? ((await app.service('locations').get(source.locationId, { provider: undefined })) as typeof location)
      : undefined
  } catch {
    location = undefined
  }
  if (location?.operationMode !== 'orders-only') reject()

  const loadBusinessDay = async (businessDayId: string) =>
    (await app.service('businessdays').get(businessDayId, {
      query: { $select: [...FISCAL_GATE_BUSINESS_DAY_SELECT] },
      provider: undefined,
    })) as BusinessDayFiscalSnapshot | undefined

  const candidates = new Set<string | undefined>([source.businessDayId])
  const currentDayId = location?.currentBusinessDay?.businessDayId
  if (currentDayId) candidates.add(currentDayId)
  for (const businessDayId of candidates) {
    if ((await resolveFiscalSignContext(businessDayId, loadBusinessDay)).sign) reject()
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

/** Praefix des virtuellen Geraete-Users aus `allow-apikey.hook.ts`. */
const DEVICE_USER_ID_PREFIX = 'device:'

/**
 * Wer hat gesplittet? (panary/panary-core#590)
 *
 * 🚨 Am POS ist `params.user._id` NICHT der Bediener, sondern `device:<uuid>`:
 * Die Kasse verbindet sich per Geraete-API-Key, `allowApiKey` setzt einen
 * virtuellen User. Ins Journal geschrieben, scheiterte jedes Ereignis an
 * `format: uuid` — still, weil das Journal nicht blockiert. Der Mensch an der
 * Kasse ist nur dem POS bekannt (PIN-Login) und reist deshalb als
 * `performedBy` mit.
 *
 * - JWT-User (Admin-Client, Tests): `params.user._id` — der Server kennt den
 *   Menschen selbst, ein mitgeschicktes `performedBy` zaehlt nicht.
 * - Geraete-Session: `performedBy`, aber nur, wenn es ein User DESSELBEN
 *   Mandanten ist. Sonst schriebe ein Geraet beliebige IDs ins Journal.
 * - Sonst: keiner.
 */
async function resolveSplitOperator(
  app: Application,
  source: Order,
  performedBy: unknown,
  params?: any,
): Promise<string | undefined> {
  const sessionUserId = params?.user?._id
  if (typeof sessionUserId !== 'string' || !sessionUserId) return undefined
  if (!sessionUserId.startsWith(DEVICE_USER_ID_PREFIX)) return sessionUserId

  if (typeof performedBy !== 'string' || !performedBy) {
    logger.warn({
      message: 'Split von einem Geraet ohne Bediener — kein Journal-Ereignis',
      event: 'order.split_journal_no_operator',
      orderId: source._id,
      tenantId: source.tenantId,
    })
    return undefined
  }

  try {
    const operator = (await app.service('users').get(performedBy, { provider: undefined })) as {
      tenantId?: string | null
    }
    if (operator?.tenantId === source.tenantId) return performedBy
  } catch {
    // Unbekannte ID — wie ein fremder Mandant behandeln, Meldung unten.
  }
  logger.warn({
    message: 'Bediener des Splits gehoert nicht zum Mandanten der Bestellung — kein Journal-Ereignis',
    event: 'order.split_journal_operator_rejected',
    orderId: source._id,
    tenantId: source.tenantId,
  })
  return undefined
}

/**
 * Journal-Ereignisse (panary/panary-core#348, Phase 5).
 *
 * 🚨 Ohne Bediener KEIN Eintrag: `orderInteractionSchema.userId` ist Pflicht,
 * und ein Journal-Ereignis ohne „wer" beantwortet die einzige Frage nicht, fuer
 * die es existiert. Interne Aufrufe ohne `params.user` schreiben deshalb
 * nichts — das ist Absicht, kein Verlust. Wer als Bediener gilt, entscheidet
 * `resolveSplitOperator`.
 *
 * Nicht blockierend, aus demselben Grund wie die Referenz oben.
 */
async function recordSplitJournal(
  app: Application,
  source: Order,
  target: Order,
  entries: ReadonlyArray<{ lineItemRowId: string; amount: number }>,
  performedBy: unknown,
  params?: any,
): Promise<void> {
  const userId = await resolveSplitOperator(app, source, performedBy, params)
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
