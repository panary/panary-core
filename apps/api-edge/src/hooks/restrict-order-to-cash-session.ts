import type { HookContext } from '@feathersjs/feathers'
import { BadRequest } from '@feathersjs/errors'

import { PairingStatus } from '@panary/cloud-connection/domain'
import { AppError, AppErrorMessages } from '@panary/shared-common'
import { OPEN_CASH_SESSION_STATUSES, BusinessDayOperationMode } from '@panary/businessdays/domain'
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

/**
 * Order-Guard: Im Cloud-Modus + pos-cashier-Betrieb wird eine Bestellung nur
 * angenommen, wenn für den aktuellen Kassierer eine offene Kasse (cash-session)
 * existiert. Sonst:
 *   - autoOpenCashSession (Location-Setting) aktiv → Kasse lazy eröffnen (Szenario B)
 *   - sonst → BadRequest CASH_SESSION_REQUIRED (Szenario A, Default)
 *
 * Bei Treffer/Auto-Open wird `order.cashSessionId` gestempelt (deterministische
 * Attribution beim Tagesabschluss, unabhängig von payment.performedBy).
 *
 * Übersprungen wird der Guard:
 *   - bei internen Aufrufen (kein provider: Sync-Apply, Bootstrap)
 *   - im Standalone-Modus (kein Cloud-Pairing → kein Kassen-Feature)
 *   - im orders-only-Betriebsmodus (keine Barzahlung)
 *   - wenn kein Kassierer ermittelbar ist (Geräte-Auth ohne PIN-User) — defensiv,
 *     damit legitime Geräte-Flows nicht blockieren (PIN-Login ist Voraussetzung
 *     für saubere Pro-Kassierer-Zuordnung; Lücke wird geloggt).
 *
 * MUSS NACH restrictOrderToBusinessDay laufen (liest context.data.businessDayId).
 */
export function restrictOrderToCashSession() {
  return async (context: HookContext) => {
    if (!context.params.provider) return context

    const data = context.data as { businessDayId?: string; cashSessionId?: string } | undefined
    const businessDayId = data?.businessDayId
    if (!data || !businessDayId) return context

    const businessDay = (await context.app.service('businessdays').get(businessDayId, {
      query: { $select: ['_id', 'tenantId', 'locationId', 'operationMode'] },
      provider: undefined,
    })) as BusinessDayLite

    // Nur Kassenbetrieb braucht eine Kasse.
    if (businessDay.operationMode !== BusinessDayOperationMode.POS_CASHIER) return context

    // Standalone → kein Kassen-Tagesabschluss-Feature.
    if (!(await isCloudPaired(context))) return context

    const cashierId = (context.params.user as { _id?: string } | undefined)?._id
    if (!cashierId) {
      logger.warn({
        message: 'restrictOrderToCashSession: kein Kassierer ermittelbar — Guard übersprungen',
        event: 'cash_session.guard_no_cashier',
        businessDayId,
      })
      return context
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

    // Keine offene Kasse → Auto-Open (Szenario B) oder Ablehnung (Szenario A).
    const cashConfig = await loadCashConfig(context, businessDay.locationId ?? null)
    if (cashConfig.autoOpen) {
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
