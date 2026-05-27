import type { HookContext } from '@feathersjs/feathers'
import { BadRequest } from '@feathersjs/errors'

import { PairingStatus } from '@panary/cloud-connection/domain'
import { AppError, AppErrorMessages } from '@panary/shared-common'
import { OPEN_CASH_SESSION_STATUSES, BusinessDayOperationMode } from '@panary/businessdays/domain'
import { OrderStatus } from '@panary/orders/domain'
import { logger } from '@panary/shared-backend'

/**
 * `true`, wenn der Edge mit der Cloud gepaart ist (CONNECTED) — auch offline
 * (die cloud-connection liegt lokal in SQLite). `false` = Standalone-Modus.
 * Im Standalone-Modus gibt es kein Multi-Kassen-Tagesabschluss-Feature → der
 * Guard greift nicht. (Bewusst dieselbe Quelle wie guardCloudManagedLifecycle /
 * cloudManaged-Hook; lokal duplizierter Lookup wie in restrict-order-to-business-day.)
 */
async function isCloudPaired(context: HookContext): Promise<boolean> {
  try {
    const result = await context.app.service('cloud-connection').find({
      provider: undefined,
      paginate: false,
      query: { pairingStatus: PairingStatus.CONNECTED, $limit: 1 },
    })
    const list = Array.isArray(result) ? result : []
    return list.length > 0
  } catch {
    // Fail-open: cloud-connection nicht erreichbar → wie Standalone behandeln,
    // damit der POS bei Infrastruktur-Problemen weiter kassieren kann.
    return false
  }
}

interface BusinessDayLite {
  _id: string
  tenantId?: string
  locationId?: string | null
  operationMode?: string
}

interface LocationCashConfig {
  autoOpen: boolean
  defaultFloatCents: number
}

/**
 * Liest die (optionale) Kassen-Auto-Open-Konfiguration aus den Location-Settings.
 * Defensiv: solange das Feld noch nicht gepflegt ist (Phase 8 ergänzt UI +
 * Schema), gilt `autoOpen=false` → Szenario A (Bestellung ablehnen).
 */
async function loadCashConfig(
  context: HookContext,
  locationId: string | null,
): Promise<LocationCashConfig> {
  const fallback: LocationCashConfig = { autoOpen: false, defaultFloatCents: 0 }
  if (!locationId) return fallback
  try {
    const loc = (await context.app.service('locations').get(locationId, {
      provider: undefined,
    })) as { settings?: { cashSession?: { autoOpen?: boolean; defaultFloatCents?: number } } }
    const cfg = loc.settings?.cashSession
    return {
      autoOpen: Boolean(cfg?.autoOpen),
      defaultFloatCents: typeof cfg?.defaultFloatCents === 'number' ? cfg.defaultFloatCents : 0,
    }
  } catch {
    return fallback
  }
}

interface OrderPatchLite {
  status?: string
  cashSessionId?: string
  payment?: { transactions?: Array<{ method?: string; performedBy?: string }> }
}

/**
 * Order-Guard beim KASSIEREN (nicht beim Aufnehmen). Greift im `before.patch`,
 * sobald eine Bestellung auf `completed` wechselt UND eine Bar-Transaktion
 * (`payment.transactions[].method === 'cash'`) enthält. Dann muss für den
 * KASSIERENDEN (`performedBy` der Bar-Transaktion) eine offene Kasse existieren:
 *   - offene Kasse vorhanden → `order.cashSessionId` stempeln
 *   - sonst autoOpenCashRegister (Location-Setting) + Default-Float > 0 → lazy eröffnen (Szenario B)
 *   - sonst → BadRequest CASH_SESSION_REQUIRED (Szenario A — POS zeigt Manager-PIN-Dialog)
 *
 * Bestellung AUFNEHMEN (create) ist immer erlaubt — der Guard läuft NICHT mehr im
 * before.create. Kassierer = `performedBy` (am POS der per PIN angemeldete User),
 * NICHT `params.user` (= Geräte-/JWT-User). Konsistent mit der Cloud-Bar-
 * Reconciliation (derive-cash-by-cashier keyt ebenfalls auf performedBy).
 *
 * Übersprungen:
 *   - interne Aufrufe (kein provider: Sync-Apply, Bootstrap)
 *   - Patches, die NICHT auf `completed` wechseln (oder schon completed sind — idempotent)
 *   - orders-only-Betriebsmodus (keine Barzahlung)
 *   - Standalone (kein Cloud-Pairing → kein Kassen-Feature)
 *   - Patches ohne Bar-Transaktion (z.B. Kartenzahlung / reiner Statuswechsel)
 */
export function restrictOrderToCashSession() {
  return async (context: HookContext) => {
    if (!context.params.provider) return context
    if (context.id == null) return context

    const data = context.data as OrderPatchLite | undefined
    if (!data || data.status !== OrderStatus.COMPLETED) return context

    // Original laden: businessDayId + bisheriger Status (Idempotenz).
    let original: { status?: string; businessDayId?: string }
    try {
      original = (await context.service.get(context.id, { provider: undefined })) as {
        status?: string
        businessDayId?: string
      }
    } catch {
      return context
    }
    if (original.status === OrderStatus.COMPLETED) return context // schon kassiert → idempotent
    const businessDayId = original.businessDayId
    if (!businessDayId) return context

    const businessDay = (await context.app.service('businessdays').get(businessDayId, {
      query: { $select: ['_id', 'tenantId', 'locationId', 'operationMode'] },
      provider: undefined,
    })) as BusinessDayLite

    if (businessDay.operationMode !== BusinessDayOperationMode.POS_CASHIER) return context
    if (!(await isCloudPaired(context))) return context

    // Bar-Transaktion im Patch? Nur Bargeld berührt die Kassenlade.
    const cashTx = data.payment?.transactions?.find(t => t.method === 'cash')
    if (!cashTx) return context // kein Bargeld (z.B. Karte) → keine Kasse nötig

    const cashierId = cashTx.performedBy
    if (!cashierId) {
      // Bar-Transaktion ohne Kassierer → nicht zuordenbar, würde Phantom-Varianz
      // im Tagesabschluss erzeugen. Ablehnen statt still durchlassen.
      logger.warn({
        message: 'restrictOrderToCashSession: Bar-Transaktion ohne performedBy beim Kassieren',
        event: 'cash_session.checkout_no_cashier',
        businessDayId,
        orderId: String(context.id),
      })
      throw new BadRequest(AppErrorMessages[AppError.CASH_SESSION_REQUIRED], {
        code: AppError.CASH_SESSION_REQUIRED,
      })
    }

    // Offene Kasse des Kassierers für diesen Geschäftstag?
    const found = (await context.app.service('cash-sessions').find({
      provider: undefined,
      paginate: false,
      query: {
        businessDayId,
        openedBy: cashierId,
        status: { $in: [...OPEN_CASH_SESSION_STATUSES] },
        $limit: 1,
      },
    })) as Array<{ _id: string }>
    const openSession = Array.isArray(found) ? found[0] : undefined

    if (openSession) {
      data.cashSessionId = openSession._id
      return context
    }

    // Keine offene Kasse → Auto-Open (Szenario B) nur mit Default-Float > 0;
    // sonst Ablehnung (Szenario A → POS-Manager-PIN-Dialog).
    const cashConfig = await loadCashConfig(context, businessDay.locationId ?? null)
    if (cashConfig.autoOpen && cashConfig.defaultFloatCents > 0) {
      const created = (await context.app.service('cash-sessions').create(
        {
          tenantId: businessDay.tenantId,
          locationId: businessDay.locationId ?? null,
          businessDayId,
          label: 'Auto-Kasse',
          openedBy: cashierId,
          openingFloatCents: cashConfig.defaultFloatCents,
        },
        { provider: undefined },
      )) as { _id: string }
      data.cashSessionId = created._id
      return context
    }

    throw new BadRequest(AppErrorMessages[AppError.CASH_SESSION_REQUIRED], {
      code: AppError.CASH_SESSION_REQUIRED,
    })
  }
}
