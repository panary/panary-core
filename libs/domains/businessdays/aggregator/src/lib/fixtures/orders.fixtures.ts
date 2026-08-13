import { Order, OrderChannel, OrderStatus, DineLocation, PaymentState, TransactionMethod } from '@panary/orders/domain'

// Test-Fixtures für Aggregator-Tests.
// Konvention: jede Funktion baut eine valide Order mit sinnvollen Defaults;
// Tests können einzelne Felder überschreiben.

let counter = 0
function id(): string {
  return `00000000-0000-7000-8000-${String(++counter).padStart(12, '0')}`
}

export function resetIds(): void {
  counter = 0
}

export interface MakeOrderOptions {
  _id?: string
  status?: (typeof OrderStatus)[keyof typeof OrderStatus]
  channel?: (typeof OrderChannel)[keyof typeof OrderChannel]
  dineLocation?: (typeof DineLocation)[keyof typeof DineLocation]
  grossAmount?: number
  tipAmount?: number
  paymentState?: (typeof PaymentState)[keyof typeof PaymentState]
  paymentMethod?: (typeof TransactionMethod)[keyof typeof TransactionMethod]
  taxes?: Array<{ rate: number; gross: number; tax: number }>
  staffPaymentInfo?: { paid: boolean } | null
  customerPaymentInfo?: { paid: boolean } | null
  cancellation?: boolean
  recordingDate?: string
  createdBy?: string
  lineItems?: Order['lineItems']
  /** Legacy-Rabattfeld — nur noch fuer Bestands-Orders relevant (ADR 0030). */
  discount?: Order['discount']
  /** Fuehrende Rabattquelle. `computedAmountCents` ist der abgezogene Brutto-Betrag. */
  appliedDiscounts?: Order['appliedDiscounts']
}

/** Minimaler AppliedDiscount-Snapshot fuer Aggregator-Tests. */
export function makeAppliedDiscount(computedAmountCents: number, overrides: Record<string, unknown> = {}) {
  return {
    _id: id(),
    discountId: null,
    name: 'Testrabatt',
    method: 'manual',
    target: 'order',
    valueType: 'percent',
    valuePercent: 10,
    valueCents: 0,
    computedAmountCents,
    appliedAt: '2026-05-15T10:00:00.000Z',
    ...overrides,
  } as NonNullable<Order['appliedDiscounts']>[number]
}

export function makeOrder(opts: MakeOrderOptions = {}): Order {
  const gross = opts.grossAmount ?? 10
  const tip = opts.tipAmount ?? 0
  const taxes = opts.taxes ?? [{ rate: 19, gross, tax: +((gross * 19) / 119).toFixed(2) }]
  const netto = +taxes.reduce((acc, t) => acc + (t.gross - t.tax), 0).toFixed(2)
  const orderId = opts._id ?? id()

  return {
    _id: orderId,
    tenantId: '00000000-0000-7000-8000-000000000001',
    locationId: '00000000-0000-7000-8000-000000000002',
    createdAt: '2026-05-15T10:00:00.000Z',
    updatedAt: '2026-05-15T10:00:00.000Z',
    status: opts.status ?? OrderStatus.COMPLETED,
    businessDayId: '00000000-0000-7000-8000-000000000003',
    orderChannel: opts.channel ?? OrderChannel.POS,
    dailySequenceNumber: 1,
    dineLocation: opts.dineLocation ?? DineLocation.DINE_IN,
    lineItems: opts.lineItems ?? [],
    cancellation: opts.cancellation
      ? { canceledBy: 'tester', reason: 'test', canceledAt: '2026-05-15T10:00:00.000Z' }
      : null,
    customerPaymentInfo:
      opts.customerPaymentInfo !== undefined
        ? opts.customerPaymentInfo
          ? { customerId: id(), customerName: 'Corp Inc', isPaid: opts.customerPaymentInfo.paid }
          : null
        : null,
    discount: opts.discount ?? null,
    ...(opts.appliedDiscounts ? { appliedDiscounts: opts.appliedDiscounts } : {}),
    staffPaymentInfo:
      opts.staffPaymentInfo !== undefined
        ? opts.staffPaymentInfo
          ? { userId: id(), userName: 'Mitarbeiter', isPaid: opts.staffPaymentInfo.paid }
          : null
        : null,
    taxSnapshot: {
      // POS-Vertrag: `amount` ist der NETTO-Anteil (= gross − tax), das Brutto
      // ergibt sich aus amount + tax. Der Fixture-Parameter `t.gross` bezeichnet
      // weiterhin das Brutto der Steuerstufe — daher amount = gross − tax.
      taxes: taxes.map(t => ({ taxRate: t.rate, amount: +(t.gross - t.tax).toFixed(2), tax: t.tax })),
      netto,
      brutto: taxes.reduce((acc, t) => acc + t.gross, 0),
    },
    creationContext: opts.createdBy ? { createdBy: opts.createdBy } : null,
    payment: {
      state: opts.paymentState ?? PaymentState.PAID,
      totalAmount: gross,
      tipAmount: tip,
      transactions: [
        {
          _id: id(),
          method: opts.paymentMethod ?? TransactionMethod.CASH,
          amount: gross,
          currency: 'EUR',
          timestamp: opts.recordingDate ?? '2026-05-15T10:00:00.000Z',
        },
      ],
    },
    isFinished: true,
    preOrderId: null,
    pager: null,
    estimatedDuration: 0,
    remainingTime: 0,
    targetCompletionAt: null,
    table: null,
    recordingDate: opts.recordingDate ?? '2026-05-15T10:00:00.000Z',
  }
}

/**
 * Ein realistischer gemischter Geschaeftstag als **Regressions-Anker**.
 *
 * Deckt bewusst jede Verzweigung ab, die der Forderungs-Umbau anfassen wird:
 * regulaere Bar- und Kartenverkaeufe, Personalessen bezahlt und offen,
 * Firmenkundenessen bezahlt und offen, einen Storno, eine Erstattung, Trinkgeld,
 * zwei Steuersaetze und eine Bestellung ohne erfasste Transaktionen (Fallback
 * nach `otherCents`).
 *
 * Die Reihenfolge ist stabil und die Betraege sind bewusst krumm — so schlaegt
 * eine versehentlich verschobene Zuordnung in den Golden Numbers sichtbar durch,
 * statt sich in runden Summen zu verstecken.
 */
export function makeMixedDay(): Order[] {
  resetIds()
  return [
    // Regulaer, bar, 19 %
    makeOrder({ grossAmount: 23.8, paymentMethod: TransactionMethod.CASH }),
    // Regulaer, bar, mit Trinkgeld. Die Transaktion traegt bewusst `gross - tip`:
    // die Persist-Invariante lautet `Σ payments === grossTotal − tips`
    // (validations.ts), und nur so haelt sie fuer diesen Tag. `makeOrder` legt
    // sonst `gross` als Transaktionsbetrag an — eine Fixture-Eigenheit, die
    // financials.spec.ts fuer sich dokumentiert, die einen Erhaltungssatz-Anker
    // aber unbrauchbar machen wuerde.
    withTransactionAmount(
      makeOrder({ grossAmount: 11.9, tipAmount: 1.1, paymentMethod: TransactionMethod.CASH }),
      10.8,
    ),
    // Regulaer, Karte, 7 %
    makeOrder({
      grossAmount: 32.1,
      paymentMethod: TransactionMethod.CARD,
      taxes: [{ rate: 7, gross: 32.1, tax: 2.1 }],
      dineLocation: DineLocation.TAKE_OUT,
    }),
    // Regulaer, Karte, Online-Kanal
    makeOrder({ grossAmount: 47.6, paymentMethod: TransactionMethod.CARD, channel: OrderChannel.ONLINE }),
    // Personalessen, bereits abgerechnet
    makeOrder({ grossAmount: 4.5, staffPaymentInfo: { paid: true }, paymentMethod: TransactionMethod.CASH }),
    // Personalessen, offen — das ist der Fall, um den es beim Forderungs-Bucket geht
    makeOrder({ grossAmount: 7.7, staffPaymentInfo: { paid: false }, paymentMethod: TransactionMethod.CASH }),
    makeOrder({ grossAmount: 5.3, staffPaymentInfo: { paid: false }, paymentMethod: TransactionMethod.CASH }),
    // Firmenkundenessen, bezahlt und offen
    makeOrder({ grossAmount: 18.9, customerPaymentInfo: { paid: true }, paymentMethod: TransactionMethod.CARD }),
    makeOrder({ grossAmount: 26.4, customerPaymentInfo: { paid: false }, paymentMethod: TransactionMethod.CASH }),
    // Storno — zaehlt in voids, nicht in gross
    makeOrder({ grossAmount: 9.9, cancellation: true }),
    // Erstattung — zaehlt in refunds, nicht in gross
    makeOrder({ grossAmount: 14.2, paymentState: PaymentState.REFUNDED }),
    // Ohne Transaktionen: faellt in den otherCents-Fallback
    withoutTransactions(makeOrder({ grossAmount: 8.4, channel: OrderChannel.TELEPHONE })),
  ]
}

/** Entfernt die Zahlungs-Transaktionen — erzwingt den `otherCents`-Fallback. */
export function withoutTransactions(order: Order): Order {
  return { ...order, payment: { ...order.payment!, transactions: [] } }
}

/** Setzt den Betrag der einzigen Transaktion (z.B. um Trinkgeld herauszurechnen). */
export function withTransactionAmount(order: Order, amount: number): Order {
  const txs = order.payment?.transactions ?? []
  return { ...order, payment: { ...order.payment!, transactions: txs.map(t => ({ ...t, amount })) } }
}
