import { createHash, createHmac } from 'node:crypto'
import { uuidv7 } from 'uuidv7'

import { logger } from '@panary/shared-backend'
import {
  buildReceiptSnapshot,
  canonicalReceiptJson,
  formatInternalReceiptNumber,
  ReceiptKind,
  type ReceiptData,
  type ReceiptLocationInput,
  type ReceiptOrderInput,
  type ReceiptTse,
} from '@panary/receipts/domain'

import type { HookContext } from '../declarations'

// === Token + Render-Hash (Phase 1: Edge-lokal; Phase 2: nach @panary/shared-backend
// gehoben, damit Cloud/Portal denselben Token verifizieren). node:crypto bleibt
// bewusst im Backend — die receipts-Domain ist isomorph/browser-safe. ===

const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// O1 (offen, siehe ADR): per-Location-Secret, Edge↔Cloud geteilt + rotierbar.
// Phase 1 nutzt das per-Instance-Auth-Secret; in Phase 2 nach @panary/shared-backend
// gehoben + per-Location verteilt (für Cloud/Portal-Verifikation).
const resolveTokenSecret = (context: HookContext): string => {
  const auth = context.app.get('authentication') as { secret?: string } | undefined
  return auth?.secret ?? 'panary-receipts-dev-secret'
}

const mintReceiptToken = (secret: string, receiptId: string): string =>
  base64url(createHmac('sha256', secret).update(`receipt:${receiptId}`).digest())

const computeRenderHash = (canonicalJson: string): string => createHash('sha256').update(canonicalJson).digest('hex')

// order.tse trägt zusätzlich `cancellation` (orderTseSchema); receiptTseSchema
// ist `additionalProperties:false` ohne dieses Feld → nur die bekannten Felder
// übernehmen, sonst Validierungs-Reject beim Anlegen.
const toReceiptTse = (tse: unknown): ReceiptTse | null => {
  if (!tse || typeof tse !== 'object') return null
  const t = tse as Record<string, unknown>
  return {
    status: t.status as ReceiptTse['status'],
    provider: String(t.provider ?? ''),
    clientId: String(t.clientId ?? ''),
    transactionNumber: Number(t.transactionNumber ?? 0),
    simulated: Boolean(t.simulated),
    ...(t.startedAt ? { startedAt: String(t.startedAt) } : {}),
    ...(t.signatureCounter != null ? { signatureCounter: Number(t.signatureCounter) } : {}),
    ...(t.signatureValue ? { signatureValue: String(t.signatureValue) } : {}),
    ...(t.signatureAlgorithm ? { signatureAlgorithm: String(t.signatureAlgorithm) } : {}),
    ...(t.logTime ? { logTime: String(t.logTime) } : {}),
    ...(t.processType ? { processType: String(t.processType) } : {}),
    ...(t.errorReason ? { errorReason: String(t.errorReason) } : {}),
  }
}

interface CompletedOrder {
  _id: string
  status?: string
  tenantId?: string
  locationId?: string
  dailySequenceNumber?: number
  recordingDate?: string
  dineLocation?: 'dine-in' | 'take-out'
  currency?: string
  lineItems?: Array<{ externalId?: string; name?: string; amount?: number; price?: number; taxInside?: number; taxOutside?: number }>
  taxSnapshot?: ReceiptOrderInput['taxSnapshot']
  payment?: ReceiptOrderInput['payment']
  tse?: unknown
}

const orderToInput = (order: CompletedOrder): ReceiptOrderInput => ({
  _id: order._id,
  dailySequenceNumber: order.dailySequenceNumber ?? 0,
  recordingDate: order.recordingDate,
  currency: order.currency,
  dineLocation: order.dineLocation,
  lineItems: (order.lineItems ?? []).map(l => ({
    ...(l.externalId ? { externalId: l.externalId } : {}),
    name: l.name ?? '',
    amount: l.amount ?? 0,
    price: l.price ?? 0,
    taxInside: l.taxInside ?? 0,
    taxOutside: l.taxOutside ?? 0,
  })),
  taxSnapshot: order.taxSnapshot ?? null,
  payment: order.payment ?? null,
  tse: toReceiptTse(order.tse),
})

const locationToInput = (location: Record<string, unknown> | undefined): ReceiptLocationInput => ({
  name: (location?.name as string) || 'Beleg',
  address: location?.address as ReceiptLocationInput['address'],
  defaultCurrency: location?.defaultCurrency as string | undefined,
  settings: location?.settings as ReceiptLocationInput['settings'],
})

/**
 * after.create / after.patch der orders: stellt beim Übergang auf 'completed'
 * genau einen persistenten Beleg aus. Kassenmodus (order.tse gesetzt) → 'sale'
 * mit Fiskal-Block; sonst → 'order-confirmation'. Idempotent (ein Beleg pro
 * Order). NIE blockierend — ein Fehler bricht den Order-Flow nicht ab.
 */
export const issueReceipt = async (context: HookContext): Promise<HookContext> => {
  // Nur Schreib-Methoden lösen eine Ausstellung aus (registriert in after.all,
  // daher Method-Guard nötig — find/get/remove sind No-Op).
  if (context.method !== 'create' && context.method !== 'patch') return context

  const order = context.result as CompletedOrder | CompletedOrder[] | undefined
  if (!order || Array.isArray(order)) return context
  if (order.status !== 'completed' || !order._id || !order.tenantId || !order.locationId) return context

  try {
    // Idempotenz: pro Order genau ein Beleg.
    const existing = (await context.app.service('receipts').find({
      query: { orderId: order._id, $limit: 0 },
      provider: undefined,
    })) as { total?: number } | unknown[]
    const total = Array.isArray(existing) ? existing.length : (existing.total ?? 0)
    if (total > 0) return context

    let location: Record<string, unknown> | undefined
    try {
      location = (await context.app.service('locations').get(order.locationId, {
        provider: undefined,
      })) as Record<string, unknown>
    } catch {
      location = undefined
    }

    const issuedAt = new Date().toISOString()
    const kind = order.tse ? ReceiptKind.SALE : ReceiptKind.ORDER_CONFIRMATION
    const receiptNumber = formatInternalReceiptNumber({
      date: order.recordingDate ?? issuedAt,
      locationId: order.locationId,
      dailySequenceNumber: order.dailySequenceNumber ?? 0,
    })

    const core = buildReceiptSnapshot({
      order: orderToInput(order),
      location: locationToInput(location),
      kind,
      issuedAt,
      receiptNumber,
    })

    const renderHash = computeRenderHash(canonicalReceiptJson(core))
    const _id = uuidv7()
    const token = mintReceiptToken(resolveTokenSecret(context), _id)

    const data: ReceiptData = {
      _id,
      tenantId: order.tenantId,
      locationId: order.locationId,
      ...core,
      status: 'issued',
      token,
      channelsUsed: [],
      renderHash,
    }

    await context.app.service('receipts').create(data, { provider: undefined })
  } catch (err) {
    logger.warn({
      message: 'Beleg-Ausstellung fehlgeschlagen — Order-Flow unberührt',
      event: 'receipts.issue_failed',
      orderId: order._id,
      errorMessage: err instanceof Error ? err.message : String(err),
    })
  }
  return context
}
