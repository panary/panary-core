import { Order, OrderChannel, OrderStatus, DineLocation, PaymentState, TransactionMethod } from '@panary/orders/domain'

// Test-Fixtures für Aggregator-Tests.
// Konvention: jede Funktion baut eine valide Order mit sinnvollen Defaults;
// Tests können einzelne Felder überschreiben.

let counter = 0
function id(): string { return `00000000-0000-7000-8000-${String(++counter).padStart(12, '0')}` }

export function resetIds(): void { counter = 0 }

export interface MakeOrderOptions {
  _id?: string
  status?: typeof OrderStatus[keyof typeof OrderStatus]
  channel?: typeof OrderChannel[keyof typeof OrderChannel]
  dineLocation?: typeof DineLocation[keyof typeof DineLocation]
  grossAmount?: number
  tipAmount?: number
  paymentState?: typeof PaymentState[keyof typeof PaymentState]
  paymentMethod?: typeof TransactionMethod[keyof typeof TransactionMethod]
  taxes?: Array<{ rate: number; gross: number; tax: number }>
  staffPaymentInfo?: { paid: boolean } | null
  customerPaymentInfo?: { paid: boolean } | null
  cancellation?: boolean
  recordingDate?: string
  createdBy?: string
  lineItems?: Order['lineItems']
}

export function makeOrder(opts: MakeOrderOptions = {}): Order {
  const gross = opts.grossAmount ?? 10
  const tip = opts.tipAmount ?? 0
  const taxes = opts.taxes ?? [{ rate: 19, gross, tax: +((gross * 19) / 119).toFixed(2) }]
  const netto = +(taxes.reduce((acc, t) => acc + (t.gross - t.tax), 0)).toFixed(2)
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
    customerPaymentInfo: opts.customerPaymentInfo !== undefined
      ? (opts.customerPaymentInfo
        ? { customerId: id(), customerName: 'Corp Inc', isPaid: opts.customerPaymentInfo.paid }
        : null)
      : null,
    discount: null,
    staffPaymentInfo: opts.staffPaymentInfo !== undefined
      ? (opts.staffPaymentInfo
        ? { userId: id(), userName: 'Mitarbeiter', isPaid: opts.staffPaymentInfo.paid }
        : null)
      : null,
    taxSnapshot: {
      // POS-Vertrag: `amount` ist der NETTO-Anteil (= gross − tax), das Brutto
      // ergibt sich aus amount + tax. Der Fixture-Parameter `t.gross` bezeichnet
      // weiterhin das Brutto der Steuerstufe — daher amount = gross − tax.
      taxes: taxes.map(t => ({ taxRate: t.rate, amount: +(t.gross - t.tax).toFixed(2), tax: t.tax })),
      netto,
      brutto: taxes.reduce((acc, t) => acc + t.gross, 0),
    },
    creationContext: opts.createdBy
      ? { createdBy: opts.createdBy }
      : null,
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
