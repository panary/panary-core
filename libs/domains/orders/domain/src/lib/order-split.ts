import type { AppliedDiscount, Order, OrderLineItem, OrderSplitOff, TaxInfo } from './order.schema'
import { OrderStatus } from './order.schema'
import { effectiveLineItems } from './effective-line-items'
import { computeOrderTax, discountAmountCents, lineItemGrossCents } from './pricing/compute-order-tax'
import { distributeByLargestRemainder, sumCents, toCents } from './pricing/money'

// Split einer Bestellung — „getrennt zahlen" (panary/panary-core#349).
//
// Rechtliche Klammer (Rechtsgutachten zu panary/panary-core#345, Volltext als
// Kommentar dort; Umsetzungsentscheidungen in ADR 0049):
//
//   A5  Der Split erzeugt neue Positionszeilen im ZIELvorgang; die Quellzeile
//       bleibt bestehen. Kein `UPDATE` auf Menge, Preis, Steuersatz oder
//       Zuordnung — der Split verschiebt nichts, er bucht um.
//   A10 Jeder Teilbeleg traegt seine EIGENE Vorgangs-Startzeit; nichts wird auf
//       den Tischbeginn zurueckdatiert.
//   A12 Rabatte werden positions- und steuersatzgenau aufgeteilt.
//   A13 Ueber denselben Umsatz stehen keine zwei nicht-stornierten Belege
//       (§ 14c UStG) — die Quelle darf nach dem Split nicht mehr den vollen
//       Betrag tragen.
//   A14 Rundungsdifferenzen bleiben stehen und werden nicht geglaettet.
//
// A5 und A13 widersprechen sich nur scheinbar: Die Aufloesung ist die
// GEGENBUCHUNG. `order.lineItems` bleibt unveraendert (die Ist-Aufnahme dessen,
// was bestellt wurde), `order.splitOff[]` haelt append-only fest, was gegangen
// ist, und `effectiveLineItems()` ist die einzige Ableitung „was traegt dieser
// Vorgang noch". Die Preis-Engine und der Bon-Renderer lesen sie.

/** Fehlercodes des Splits. Der Edge mappt sie auf HTTP-Fehler. */
export const OrderSplitErrorCode = {
  /** Quelle ist abgeschlossen oder storniert (A6). */
  SOURCE_NOT_SPLITTABLE: 'order-split/source-not-splittable',
  /** Auswahl ist leer. */
  EMPTY_SELECTION: 'order-split/empty-selection',
  /** Referenzierte Zeile gibt es in der Quelle nicht. */
  UNKNOWN_LINE: 'order-split/unknown-line',
  /** Dieselbe Zeile mehrfach in einer Auswahl. */
  DUPLICATE_LINE: 'order-split/duplicate-line',
  /** Mehr verlangt, als die Zeile noch traegt. */
  AMOUNT_EXCEEDS_REMAINDER: 'order-split/amount-exceeds-remainder',
  /** Teilmenge einer Zeile mit Modifiern/Komponenten — siehe `assertPartialSplitAllowed`. */
  PARTIAL_SPLIT_UNSUPPORTED: 'order-split/partial-split-unsupported',
  /** Es bliebe nichts zurueck — das waere eine Umbuchung, kein Split. */
  NOTHING_REMAINS: 'order-split/nothing-remains',
} as const
export type OrderSplitErrorCode = (typeof OrderSplitErrorCode)[keyof typeof OrderSplitErrorCode]

/**
 * Fehler des Split-Planers.
 *
 * 🚨 Traegt einen `code`, weil eine Ablehnung sprechend sein muss: Der Plan zu
 * #349 verlangt ausdruecklich „Ablehnung mit sprechendem Fehlercode, nicht
 * still". Ein reiner Text waere am Client nicht unterscheidbar.
 */
export class OrderSplitError extends Error {
  constructor(
    public readonly code: OrderSplitErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OrderSplitError'
  }
}

/** Eine Zeile der Split-Auswahl. */
export interface OrderSplitSelectionItem {
  /** `lineItem._id` der QUELLZEILE (Zeilenidentitaet, ADR 0033) — nicht `externalId`. */
  lineItemRowId: string
  /** Menge, die wandert. Fehlt = die volle Restmenge der Zeile. */
  amount?: number
}

export interface OrderSplitPlanInput {
  /** `_id` der neu entstehenden Zielbestellung (vom Aufrufer vergeben). */
  targetOrderId: string
  /** Zeitpunkt des Splits (ISO 8601). Eine Quelle fuer alle Zeitstempel des Vorgangs. */
  splitAt: string
  /** ID-Fabrik fuer neue Zeilen-/Rabatt-/Umbuchungs-IDs — bewusst injiziert, damit die Domain rein und der Test deterministisch bleibt. */
  newId: () => string
}

export interface OrderSplitPlan {
  /** Positionen der Zielbestellung — neue `_id`, Artikelidentitaet ueber `externalId` (ADR 0033). */
  targetLineItems: OrderLineItem[]
  /** Rabatte der Zielbestellung (aufgeteilter Anteil). */
  targetAppliedDiscounts: AppliedDiscount[]
  /** `taxSnapshot` der Zielbestellung. */
  targetTaxSnapshot: TaxInfo
  /** Gegenbuchungen, die an die QUELLE angehaengt werden. */
  splitOffEntries: OrderSplitOff[]
  /** Rabatte der Quelle NACH der Aufteilung (Festbetraege sind gekuerzt). */
  sourceAppliedDiscounts: AppliedDiscount[]
  /** `taxSnapshot` der Quelle nach dem Split. */
  sourceTaxSnapshot: TaxInfo
  /** A14 — Ursprungs-Brutto minus (Rest + Ziel), in Cents. Darf negativ sein. */
  roundingRemainderCents: number
}

/**
 * Darf diese Zeile in TEILmenge gesplittet werden?
 *
 * 🚫 Nein, sobald sie Modifier, Bundle-Komponenten oder die Legacy-Menue-Slots
 * traegt. Der Grund ist gemessen und nicht Vorsicht: Ein Modifier zaehlt mit
 * SEINEM EIGENEN `amount` und skaliert NICHT mit der Menge der Hauptzeile
 * (`modifiersGrossCents` ohne `scale`-Argument). Wuerde man „3 von 5" abgeben,
 * traegt die Quelle den Aufpreis weiter voll UND das Ziel bekaeme ihn noch
 * einmal — der Split erfaende Umsatz. Bundle-Komponenten haben die
 * spiegelbildliche Falle (`FIXED_PROPORTIONAL` verteilt einen Festpreis).
 *
 * Eine GANZE solche Zeile zu verschieben ist unproblematisch und erlaubt: Dann
 * wandert die Zeile mit ihren Modifiern unveraendert.
 */
export function isPartiallySplittable(line: OrderLineItem): boolean {
  const l = line as OrderLineItem & {
    components?: unknown[]
    menuDrink?: unknown
    menuSideDish?: unknown
  }
  if (Array.isArray(line.modifiers) && line.modifiers.length > 0) return false
  if (Array.isArray(l.components) && l.components.length > 0) return false
  if (l.menuDrink || l.menuSideDish) return false
  return true
}

/**
 * Vorbedingungen der Quelle (A6).
 *
 * 🚨 `COMPLETED` ist in der Status-FSM NICHT hart terminal (`COMPLETED →
 * UNCLAIMED`/`→ ABORTED` sind erlaubt). Hier wird trotzdem hart abgelehnt: A6
 * verlangt woertlich, dass es keinen Code-Pfad gibt, der einen abgeschlossenen
 * Vorgang wieder oeffnet. Der Status-Guard ist also KEIN Ersatz fuer diese
 * Pruefung.
 */
export function assertOrderIsSplittable(order: Pick<Order, 'status'>): void {
  if (order.status === OrderStatus.COMPLETED) {
    throw new OrderSplitError(
      OrderSplitErrorCode.SOURCE_NOT_SPLITTABLE,
      'Eine abgeschlossene Bestellung kann nicht gesplittet werden.',
    )
  }
  if (order.status === OrderStatus.ABORTED) {
    throw new OrderSplitError(
      OrderSplitErrorCode.SOURCE_NOT_SPLITTABLE,
      'Eine stornierte Bestellung kann nicht gesplittet werden.',
    )
  }
}

/** Kopiert einen Rabatt-Snapshot mit neuer `_id` (und optional neuer Positionsbindung). */
function copyDiscount(source: AppliedDiscount, newId: string, lineItemId?: string | null): AppliedDiscount {
  return {
    ...source,
    _id: newId,
    ...(lineItemId === undefined ? {} : { lineItemId }),
  }
}

/** Brutto einer Zeile nach den auf SIE gebuchten LINE-Rabatten, in Cents. */
function lineGrossAfterLineDiscounts(line: OrderLineItem, applied: AppliedDiscount[]): number {
  const base = lineItemGrossCents(line)
  let rest = base
  for (const ad of applied) {
    if (ad.target !== 'line' || ad.lineItemId !== line._id) continue
    rest -= discountAmountCents(ad.valueType, ad.valuePercent, ad.valueCents, rest)
  }
  return Math.max(0, rest)
}

/**
 * Plant einen Split. Reine Funktion — sie schreibt nichts und mutiert die
 * uebergebene Bestellung nicht.
 *
 * 🚨 Positionssummen werden NIE selbst gerechnet: Alles laeuft ueber
 * `lineItemGrossCents`/`computeOrderTax` aus derselben Engine, die den
 * `taxSnapshot` erzeugt. Eine zweite Formel waere genau die Abweichung, die
 * spaeter als „Bon stimmt nicht mit der API ueberein" auftaucht.
 */
export function planOrderSplit(
  source: Order,
  selection: ReadonlyArray<OrderSplitSelectionItem>,
  input: OrderSplitPlanInput,
): OrderSplitPlan {
  assertOrderIsSplittable(source)

  if (!selection || selection.length === 0) {
    throw new OrderSplitError(OrderSplitErrorCode.EMPTY_SELECTION, 'Die Split-Auswahl ist leer.')
  }

  const seen = new Set<string>()
  for (const item of selection) {
    if (seen.has(item.lineItemRowId)) {
      throw new OrderSplitError(
        OrderSplitErrorCode.DUPLICATE_LINE,
        `Die Zeile ${item.lineItemRowId} steht mehrfach in der Auswahl.`,
      )
    }
    seen.add(item.lineItemRowId)
  }

  // Auf einer Kopie planen: `computeOrderTax` schreibt `computedAmountCents` als
  // Seiteneffekt in `appliedDiscounts` zurueck. Ohne die Kopie veraenderte der
  // Planer den Datensatz des Aufrufers, bevor irgendetwas entschieden ist.
  const working: Order = structuredClone(source)
  const sourceAppliedBefore: AppliedDiscount[] = Array.isArray(working.appliedDiscounts) ? working.appliedDiscounts : []
  const bruttoBeforeCents = toCents(computeOrderTax(working).brutto)

  const effective = effectiveLineItems(working)
  const effectiveById = new Map(effective.map(l => [l._id, l]))

  // --- 1. Zielzeilen + Gegenbuchungen bilden ---
  const targetLineItems: OrderLineItem[] = []
  const splitOffEntries: OrderSplitOff[] = []
  // Zuordnung Quellzeile → Zielzeile, fuer die Rabatt-Umhaengung weiter unten.
  const targetLineBySourceRow = new Map<string, OrderLineItem>()
  const movedFullyByRow = new Map<string, boolean>()

  for (const item of selection) {
    const line = effectiveById.get(item.lineItemRowId)
    if (!line) {
      throw new OrderSplitError(
        OrderSplitErrorCode.UNKNOWN_LINE,
        `Die Bestellung traegt keine offene Zeile ${item.lineItemRowId}.`,
      )
    }

    const requested = item.amount ?? line.amount
    if (!Number.isFinite(requested) || requested <= 0) {
      throw new OrderSplitError(
        OrderSplitErrorCode.AMOUNT_EXCEEDS_REMAINDER,
        `Die Menge fuer Zeile ${item.lineItemRowId} muss groesser als 0 sein.`,
      )
    }
    if (requested > line.amount) {
      throw new OrderSplitError(
        OrderSplitErrorCode.AMOUNT_EXCEEDS_REMAINDER,
        `Zeile ${item.lineItemRowId} traegt nur noch ${line.amount}, angefordert wurden ${requested}.`,
      )
    }

    const whole = requested === line.amount
    if (!whole && !isPartiallySplittable(line)) {
      throw new OrderSplitError(
        OrderSplitErrorCode.PARTIAL_SPLIT_UNSUPPORTED,
        `Zeile ${item.lineItemRowId} traegt Extras oder Menue-Bestandteile und kann nur vollstaendig gesplittet werden.`,
      )
    }

    const targetLine: OrderLineItem = { ...structuredClone(line), _id: input.newId(), amount: requested }
    targetLineItems.push(targetLine)
    targetLineBySourceRow.set(line._id, targetLine)
    movedFullyByRow.set(line._id, whole)

    splitOffEntries.push({
      _id: input.newId(),
      targetOrderId: input.targetOrderId,
      lineItemRowId: line._id,
      amount: requested,
      // Vorlaeufig; der exakte Anteil steht erst, wenn der Ziel-Snapshot
      // gerechnet ist (unten, summen-exakt verteilt).
      grossCents: 0,
      splitAt: input.splitAt,
    })
  }

  // --- 2. Bliebe ueberhaupt etwas zurueck? ---
  const sourceAfterLines = effectiveLineItems({
    lineItems: working.lineItems,
    splitOff: [...(working.splitOff ?? []), ...splitOffEntries],
  })
  if (sourceAfterLines.length === 0) {
    throw new OrderSplitError(
      OrderSplitErrorCode.NOTHING_REMAINS,
      'Der Split wuerde die Quellbestellung leer zuruecklassen. Das ist eine Umbuchung, kein Split.',
    )
  }

  // --- 3. Rabatte aufteilen (A12) ---
  const targetAppliedDiscounts: AppliedDiscount[] = []
  const sourceAppliedDiscounts: AppliedDiscount[] = []

  // Gewichte fuer die Aufteilung von FESTBETRAEGEN: Brutto nach LINE-Rabatten,
  // je Seite. Prozentrabatte brauchen keine Gewichte — sie wirken auf der
  // jeweiligen Basis und teilen sich dadurch von selbst.
  const targetWeight = sumCents(targetLineItems.map(l => lineGrossAfterLineDiscounts(l, sourceAppliedBefore)))
  const sourceWeight = sumCents(sourceAfterLines.map(l => lineGrossAfterLineDiscounts(l, sourceAppliedBefore)))

  for (const ad of sourceAppliedBefore) {
    if (ad.target === 'line') {
      const targetLine = ad.lineItemId ? targetLineBySourceRow.get(ad.lineItemId) : undefined
      if (!targetLine) {
        sourceAppliedDiscounts.push(ad)
        continue
      }
      const fully = movedFullyByRow.get(ad.lineItemId as string) === true
      if (fully) {
        // Ganze Zeile gewandert → der Rabatt wandert mit und verschwindet aus
        // der Quelle. Er bliebe sonst als Rabatt ohne Position stehen.
        targetAppliedDiscounts.push(copyDiscount(ad, input.newId(), targetLine._id))
        continue
      }
      if (ad.valueType === 'percent') {
        // Prozent wirkt auf der jeweiligen Zeilenbasis — beide Seiten tragen
        // denselben Satz, die Betraege ergeben sich.
        sourceAppliedDiscounts.push(ad)
        targetAppliedDiscounts.push(copyDiscount(ad, input.newId(), targetLine._id))
        continue
      }
      // Festbetrag auf einer teilweise gewanderten Zeile: summen-exakt teilen.
      const sourceLine = sourceAfterLines.find(l => l._id === ad.lineItemId)
      const weights = [sourceLine ? lineItemGrossCents(sourceLine) : 0, lineItemGrossCents(targetLine)]
      const [sourceShare, targetShare] = distributeByLargestRemainder(ad.valueCents, weights)
      sourceAppliedDiscounts.push({ ...ad, valueCents: sourceShare })
      targetAppliedDiscounts.push({ ...copyDiscount(ad, input.newId(), targetLine._id), valueCents: targetShare })
      continue
    }

    // ORDER-Rabatt
    if (ad.valueType === 'percent') {
      sourceAppliedDiscounts.push(ad)
      targetAppliedDiscounts.push(copyDiscount(ad, input.newId()))
      continue
    }
    const [sourceShare, targetShare] = distributeByLargestRemainder(ad.valueCents, [sourceWeight, targetWeight])
    sourceAppliedDiscounts.push({ ...ad, valueCents: sourceShare })
    targetAppliedDiscounts.push({ ...copyDiscount(ad, input.newId()), valueCents: targetShare })
  }

  // --- 4. Steuer-Snapshots ---
  // Dieselbe Engine, die den urspruenglichen Snapshot erzeugt hat, auf den
  // ZUGEORDNETEN Positionsanteilen. Kein Katalog-Lookup, keine Neubepreisung —
  // `computeOrderTax` ist eine reine Funktion ueber den persistierten Snapshot.
  const targetDraft = {
    ...working,
    _id: input.targetOrderId,
    lineItems: targetLineItems,
    splitOff: [],
    appliedDiscounts: targetAppliedDiscounts,
  } as Order
  const targetTaxSnapshot = computeOrderTax(targetDraft)

  const sourceDraft = {
    ...working,
    splitOff: [...(working.splitOff ?? []), ...splitOffEntries],
    appliedDiscounts: sourceAppliedDiscounts,
  } as Order
  const sourceTaxSnapshot = computeOrderTax(sourceDraft)

  // --- 5. Gegenbuchungs-Betraege summen-exakt auf die Eintraege verteilen ---
  const entryWeights = splitOffEntries.map(entry => {
    const targetLine = targetLineBySourceRow.get(entry.lineItemRowId)
    return targetLine ? lineGrossAfterLineDiscounts(targetLine, targetAppliedDiscounts) : 0
  })
  const targetBruttoCents = toCents(targetTaxSnapshot.brutto)
  const entryShares = distributeByLargestRemainder(targetBruttoCents, entryWeights)
  splitOffEntries.forEach((entry, i) => {
    entry.grossCents = entryShares[i]
  })

  // --- 6. Rundungsrest (A14) — ausweisen, nicht glaetten ---
  const roundingRemainderCents = bruttoBeforeCents - (toCents(sourceTaxSnapshot.brutto) + targetBruttoCents)

  return {
    targetLineItems,
    targetAppliedDiscounts,
    targetTaxSnapshot,
    splitOffEntries,
    sourceAppliedDiscounts,
    sourceTaxSnapshot,
    roundingRemainderCents,
  }
}
