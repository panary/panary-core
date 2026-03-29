import { uuidv7 } from 'uuidv7'
import type { HookContext, NextFunction } from '../declarations'
import { logger } from '../logger'

const SENSITIVE_FIELDS = ['password', 'posPin', 'apikey', 'secret', 'token']

/**
 * Wide Event / Canonical Log Line Hook.
 *
 * Erzeugt pro Service-Call genau eine strukturierte JSON-Logzeile mit allen
 * relevanten Dimensionen: Wer, Was, Wie lange, Ergebnis.
 *
 * Muss als äußerster around.all-Hook auf App-Ebene registriert werden,
 * damit er den gesamten Request-Lifecycle umschließt (inkl. Fehler).
 */
export const canonicalLog = async (context: HookContext, next: NextFunction) => {
  // Interne Aufrufe (kein Provider) nicht loggen — zu viel Noise
  if (!context.params.provider) {
    await next()
    return
  }

  const requestId = uuidv7()
  const start = performance.now()

  // requestId auf dem Context verfügbar machen (z.B. für X-Request-Id Header)
  context.params.requestId = requestId

  const event: Record<string, unknown> = {
    requestId,
    service: context.path,
    method: context.method,
    provider: context.params.provider,
  }

  try {
    await next()

    // Erfolg — Kontext nach Hook-Chain auslesen (User ist jetzt verfügbar)
    enrichWithUserContext(event, context)
    enrichWithBusinessContext(event, context)
    event.status = 'success'
    event.statusCode = getSuccessStatusCode(context.method)
    event.resultCount = getResultCount(context.result)
    event.duration_ms = Math.round(performance.now() - start)

    logger.info(event)
  } catch (error: unknown) {
    const err = error as Record<string, unknown> & { code?: number; name?: string; message?: string; stack?: string; data?: unknown }

    enrichWithUserContext(event, context)
    enrichWithBusinessContext(event, context)
    event.status = 'error'
    event.statusCode = err.code || 500
    event.errorName = err.name
    event.errorMessage = err.message
    event.duration_ms = Math.round(performance.now() - start)

    // Validierungsfehler: Details mitloggen
    if (err.code === 400 && err.data) {
      event.validationErrors = err.data
    }

    // Bei 400-Fehlern: sanitierte Request-Daten hinzufügen
    if (err.code === 400 && context.data) {
      event.requestData = sanitizeData(context.data)
    }

    // 5xx: Stack-Trace anhängen
    if (!err.code || err.code >= 500) {
      event.errorStack = err.stack
      if (err.data) event.errorData = err.data
      logger.error(event)
    } else if (err.code === 409) {
      logger.warn(event)
    } else {
      logger.warn(event)
    }

    throw error
  }
}

// --- User-Kontext ---

function enrichWithUserContext(event: Record<string, unknown>, context: HookContext) {
  const user = context.params?.user as Record<string, unknown> | undefined
  if (!user) return

  event.userId = user._id
  event.userRole = user.role
  event.tenantId = user.tenantId
  event.locationId = user.locationId || user.activeLocationId

  if (typeof user._id === 'string' && user._id.startsWith('device:')) {
    event.deviceId = user._id.replace('device:', '')
  }
}

// --- Business-Kontext ---

function enrichWithBusinessContext(event: Record<string, unknown>, context: HookContext) {
  const result = getSingleResult(context.result)
  const biz: Record<string, unknown> = {}

  switch (context.path) {
    case 'orders':
      enrichOrderContext(biz, result, context)
      break
    case 'products':
      enrichProductContext(biz, result)
      break
    case 'users':
      enrichUserMethodContext(biz, context)
      break
    case 'working-times':
      enrichWorkingTimeContext(biz, result)
      break
    case 'order-interactions':
      enrichOrderInteractionContext(biz, result)
      break
  }

  if (Object.keys(biz).length > 0) {
    event.businessContext = biz
  }
}

function enrichOrderContext(biz: Record<string, unknown>, result: Record<string, unknown> | null, context: HookContext) {
  const source = result || (context.data as Record<string, unknown> | undefined)
  if (!source) return

  if (source.orderChannel) biz.orderChannel = source.orderChannel
  if (source.dineLocation) biz.dineLocation = source.dineLocation
  if (source.dailySequenceNumber != null) biz.dailySequenceNumber = source.dailySequenceNumber
  if (source.status) biz.orderStatus = source.status

  // Line-Items: Nur Anzahl, keine Inhalte
  const items = source.lineItems as unknown[] | undefined
  if (Array.isArray(items)) {
    biz.lineItemCount = items.length
  }

  // Payment: Nur Zustand und Betrag — keine Transaktionsdetails
  const payment = source.payment as Record<string, unknown> | undefined
  if (payment) {
    biz.paymentState = payment.state
    if (payment.totalAmount != null) biz.grossAmount = payment.totalAmount

    // Zahlungsmethode aus erster Transaktion (ohne Transaktions-Daten)
    const txs = payment.transactions as Record<string, unknown>[] | undefined
    if (Array.isArray(txs) && txs.length > 0) {
      biz.paymentMethod = txs[0].method
    }
  }

  // Tax-Snapshot: Nur Netto/Brutto
  const tax = source.taxSnapshot as Record<string, unknown> | undefined
  if (tax) {
    if (tax.netto != null) biz.netAmount = tax.netto
    if (tax.brutto != null) biz.grossAmount = tax.brutto
  }

  // Tisch / Pager
  if (source.table) biz.table = source.table
}

function enrichProductContext(biz: Record<string, unknown>, result: Record<string, unknown> | null) {
  if (!result) return

  if (result.productType) biz.productType = result.productType
  if (result.status) biz.productStatus = result.status
  if (result.price != null) biz.price = result.price

  // Verfügbarkeit: Nur Modus und Bestandslevel
  const avail = result.availability as Record<string, unknown> | undefined
  if (avail) {
    if (avail.mode) biz.availabilityMode = avail.mode
    if (avail.stock != null) biz.stockLevel = avail.stock
  }
}

function enrichUserMethodContext(biz: Record<string, unknown>, context: HookContext) {
  // Custom Methods: checkin, checkout, startBreak, endBreak
  const method = context.method
  if (!['checkin', 'checkout', 'startBreak', 'endBreak'].includes(method)) return

  biz.operation = method === 'checkin' ? 'clock-in'
    : method === 'checkout' ? 'clock-out'
    : method === 'startBreak' ? 'break-start'
    : 'break-end'
}

function enrichWorkingTimeContext(biz: Record<string, unknown>, result: Record<string, unknown> | null) {
  if (!result) return

  if (result.checkinDate) biz.checkinDate = result.checkinDate
  if (result.checkoutDate) biz.checkoutDate = result.checkoutDate

  const breaks = result.breaks as unknown[] | undefined
  if (Array.isArray(breaks)) {
    biz.breakCount = breaks.length
  }

  if (result.businessDay) biz.businessDate = result.businessDay
}

function enrichOrderInteractionContext(biz: Record<string, unknown>, result: Record<string, unknown> | null) {
  if (!result) return

  if (result.type) biz.interactionType = result.type
  if (result.orderId) biz.orderId = result.orderId
  if (result.deletedQuantity != null) biz.deletedQuantity = result.deletedQuantity
  if (result.businessDate) biz.businessDate = result.businessDate
}

// --- Hilfsfunktionen ---

function getSingleResult(result: unknown): Record<string, unknown> | null {
  if (result == null) return null
  if (Array.isArray(result)) return result.length === 1 ? result[0] : null
  if (typeof result === 'object' && 'data' in (result as Record<string, unknown>)) {
    const data = (result as Record<string, unknown>).data
    return Array.isArray(data) && data.length === 1 ? data[0] : null
  }
  return result as Record<string, unknown>
}

function getResultCount(result: unknown): number | undefined {
  if (result == null) return undefined
  if (Array.isArray(result)) return result.length
  if (typeof result === 'object' && 'data' in (result as Record<string, unknown>)) {
    const data = (result as Record<string, unknown>).data
    return Array.isArray(data) ? data.length : undefined
  }
  return 1
}

function getSuccessStatusCode(method: string): number {
  if (method === 'create') return 201
  if (method === 'remove') return 200
  return 200
}

function sanitizeData(data: unknown): unknown {
  if (!data || typeof data !== 'object') return data
  const sanitized = { ...(data as Record<string, unknown>) }
  for (const field of SENSITIVE_FIELDS) {
    if (field in sanitized) sanitized[field] = '***'
  }
  return sanitized
}
