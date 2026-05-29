import type { Receipt, ReceiptLineItem, ReceiptSeller, ReceiptTse } from './receipt.schema'
import { ReceiptKind } from './receipt.schema'

// Reine, deterministische Beleg-Erzeugung (ADR D3/D7). KEINE node-Abhängigkeit
// (node:crypto) — die Domain-Lib ist isomorph (auch vom Frontend konsumiert).
// Hashing (sha256/renderHash) und HMAC-Token leben im Backend, das diesen
// reinen Snapshot + `canonicalReceiptJson` nutzt.

//#region Eingabe-Typen (strukturell, ohne orders/domain-Import)
export interface ReceiptOrderLineInput {
  externalId?: string
  name: string
  amount: number
  price: number
  taxInside: number
  taxOutside: number
}

export interface ReceiptOrderInput {
  _id: string
  dailySequenceNumber: number
  recordingDate?: string
  currency?: string
  dineLocation?: 'dine-in' | 'take-out'
  lineItems: ReceiptOrderLineInput[]
  taxSnapshot?: {
    taxes: Array<{ taxRate: number; amount: number; tax: number }>
    netto: number
    brutto: number
  } | null
  payment?: {
    state?: string
    totalAmount?: number
    transactions?: Array<{ method?: string }>
  } | null
  tse?: ReceiptTse | null
}

export interface ReceiptLocationInput {
  name: string
  address?: { street?: string; postalCode?: string; city?: string; country?: string }
  defaultCurrency?: string
  settings?: { invoiceSettings?: { taxNumber?: string; taxIdentificationNumber?: string } }
}

export interface BuildReceiptSnapshotInput {
  order: ReceiptOrderInput
  location: ReceiptLocationInput
  kind: (typeof ReceiptKind)[keyof typeof ReceiptKind]
  issuedAt: string
  receiptNumber?: string
}
//#endregion

// Stabiler, identifizierender Inhalt eines Belegs (= Grundlage des renderHash).
// Enthält NICHT die volatilen Felder (_id, token, renderHash, Zeitstempel,
// status, channelsUsed) — diese setzt der Backend-Hook.
export interface ReceiptSnapshotCore {
  kind: ReceiptSnapshotCoreKind
  orderId: string
  dailySequenceNumber: number
  issuedAt: string
  currency: string
  lineItems: ReceiptLineItem[]
  taxSummary: { taxes: Array<{ taxRate: number; amount: number; tax: number }>; netto: number; brutto: number }
  totalGross: number
  paymentMethod?: 'cash' | 'card' | 'online' | 'other'
  paymentState?: 'pending' | 'partially_paid' | 'paid' | 'refunded'
  seller: ReceiptSeller
  tse?: ReceiptTse | null
  receiptNumber?: string
}
type ReceiptSnapshotCoreKind = (typeof ReceiptKind)[keyof typeof ReceiptKind]

const round2 = (n: number): number => Math.round(n * 100) / 100

// Der anzuwendende Steuersatz hängt vom Verzehrort ab: im Haus → taxInside,
// außer Haus → taxOutside (Gastro 19 % vs. 7 %). Default: im Haus.
const lineTaxRate = (line: ReceiptOrderLineInput, dineLocation: 'dine-in' | 'take-out' | undefined): number =>
  dineLocation === 'take-out' ? line.taxOutside : line.taxInside

const toReceiptLine = (
  line: ReceiptOrderLineInput,
  dineLocation: 'dine-in' | 'take-out' | undefined,
): ReceiptLineItem => ({
  ...(line.externalId ? { externalId: line.externalId } : {}),
  name: line.name,
  quantity: line.amount,
  unitPrice: line.price,
  lineTotal: round2(line.amount * line.price),
  taxRate: lineTaxRate(line, dineLocation),
})

// Fallback-Steuer-Aufschlüsselung aus den Positionen, falls die Order keinen
// (autoritativen) taxSnapshot trägt. Gruppiert nach Satz, rechnet Netto/Steuer
// aus dem Brutto heraus (inklusive Steuer).
const taxSummaryFromLines = (lines: ReceiptLineItem[]) => {
  const byRate = new Map<number, number>()
  for (const l of lines) byRate.set(l.taxRate, (byRate.get(l.taxRate) ?? 0) + l.lineTotal)
  const taxes = [...byRate.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([taxRate, brutto]) => {
      const netto = taxRate > 0 ? brutto / (1 + taxRate / 100) : brutto
      return { taxRate, amount: round2(netto), tax: round2(brutto - netto) }
    })
  const brutto = round2(taxes.reduce((s, t) => s + t.amount + t.tax, 0))
  const netto = round2(taxes.reduce((s, t) => s + t.amount, 0))
  return { taxes, netto, brutto }
}

const formatSellerAddress = (address: ReceiptLocationInput['address']): string | undefined => {
  if (!address) return undefined
  const parts = [address.street, [address.postalCode, address.city].filter(Boolean).join(' '), address.country]
  const joined = parts.filter(p => p && p.trim().length > 0).join(', ')
  return joined.length > 0 ? joined : undefined
}

const PAYMENT_METHODS = ['cash', 'card', 'online', 'other'] as const
const PAYMENT_STATES = ['pending', 'partially_paid', 'paid', 'refunded'] as const

/**
 * Reine Transformation order + location + kind → strukturierter Beleg-Snapshot
 * (Source of Truth). Deterministisch — gleiche Eingabe ⇒ gleicher renderHash.
 */
export const buildReceiptSnapshot = (input: BuildReceiptSnapshotInput): ReceiptSnapshotCore => {
  const { order, location, kind, issuedAt } = input
  const currency = order.currency ?? location.defaultCurrency ?? 'EUR'

  const lineItems = order.lineItems.map(l => toReceiptLine(l, order.dineLocation))

  const taxSummary =
    order.taxSnapshot && order.taxSnapshot.taxes.length > 0
      ? {
          taxes: order.taxSnapshot.taxes.map(t => ({ taxRate: t.taxRate, amount: t.amount, tax: t.tax })),
          netto: order.taxSnapshot.netto,
          brutto: order.taxSnapshot.brutto,
        }
      : taxSummaryFromLines(lineItems)

  const totalGross =
    order.payment?.totalAmount != null
      ? order.payment.totalAmount
      : taxSummary.brutto > 0
        ? taxSummary.brutto
        : round2(lineItems.reduce((s, l) => s + l.lineTotal, 0))

  const lastMethod = order.payment?.transactions?.at(-1)?.method
  const paymentMethod = PAYMENT_METHODS.find(m => m === lastMethod)
  const paymentState = PAYMENT_STATES.find(s => s === order.payment?.state)

  const seller: ReceiptSeller = {
    name: location.name,
    ...(formatSellerAddress(location.address) ? { address: formatSellerAddress(location.address) } : {}),
    ...(location.settings?.invoiceSettings?.taxNumber
      ? { taxNumber: location.settings.invoiceSettings.taxNumber }
      : {}),
    ...(location.settings?.invoiceSettings?.taxIdentificationNumber
      ? { vatId: location.settings.invoiceSettings.taxIdentificationNumber }
      : {}),
  }

  return {
    kind,
    orderId: order._id,
    dailySequenceNumber: order.dailySequenceNumber,
    issuedAt,
    currency,
    lineItems,
    taxSummary,
    totalGross: round2(totalGross),
    ...(paymentMethod ? { paymentMethod } : {}),
    ...(paymentState ? { paymentState } : {}),
    seller,
    // Beleg-Typ order-confirmation trägt nie einen Fiskal-Block.
    tse: kind === ReceiptKind.ORDER_CONFIRMATION ? null : (order.tse ?? null),
    ...(input.receiptNumber ? { receiptNumber: input.receiptNumber } : {}),
  }
}

// Deterministische, schlüssel-sortierte JSON-Serialisierung — Grundlage des
// renderHash. Gleicher Inhalt ⇒ exakt gleicher String ⇒ gleicher Hash.
const sortValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortValue)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}

export const canonicalReceiptJson = (snapshot: ReceiptSnapshotCore): string => JSON.stringify(sortValue(snapshot))

// Minimaler, deterministischer HTML-Render eines Belegs (render-on-demand).
// Bewusst dependency-frei; das ausführliche Theming/PDF folgt in Phase 2/3.
const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const money = (n: number, currency: string): string => `${n.toFixed(2)} ${currency}`

export const buildReceiptHtml = (receipt: Pick<Receipt,
  'kind' | 'currency' | 'issuedAt' | 'dailySequenceNumber' | 'lineItems' | 'taxSummary' | 'totalGross' | 'seller' | 'tse' | 'receiptNumber'
>): string => {
  const rows = receipt.lineItems
    .map(
      l =>
        `<tr><td>${esc(l.name)}</td><td>${l.quantity}</td><td>${money(l.lineTotal, receipt.currency)}</td><td>${l.taxRate}%</td></tr>`,
    )
    .join('')
  const taxRows = receipt.taxSummary.taxes
    .map(t => `<tr><td>${t.taxRate}%</td><td>${money(t.amount, receipt.currency)}</td><td>${money(t.tax, receipt.currency)}</td></tr>`)
    .join('')
  const tseBlock = receipt.tse
    ? `<section class="tse"><div>TSE: ${esc(receipt.tse.provider)} · Tx ${receipt.tse.transactionNumber}</div>${
        receipt.tse.signatureValue ? `<div class="sig">${esc(receipt.tse.signatureValue)}</div>` : ''
      }</section>`
    : ''
  return [
    '<!doctype html><html lang="de"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>Beleg ${receipt.dailySequenceNumber}</title></head><body>`,
    `<header><h1>${esc(receipt.seller.name)}</h1>`,
    receipt.seller.address ? `<div>${esc(receipt.seller.address)}</div>` : '',
    receipt.seller.taxNumber ? `<div>St-Nr: ${esc(receipt.seller.taxNumber)}</div>` : '',
    '</header>',
    `<div>Beleg-Nr: ${esc(receipt.receiptNumber ?? String(receipt.dailySequenceNumber))}</div>`,
    `<div>Datum: ${esc(receipt.issuedAt)}</div>`,
    `<table><thead><tr><th>Position</th><th>Menge</th><th>Summe</th><th>MwSt</th></tr></thead><tbody>${rows}</tbody></table>`,
    `<div class="total">Gesamt: ${money(receipt.totalGross, receipt.currency)}</div>`,
    `<table class="tax"><thead><tr><th>Satz</th><th>Netto</th><th>Steuer</th></tr></thead><tbody>${taxRows}</tbody></table>`,
    tseBlock,
    '</body></html>',
  ].join('')
}
