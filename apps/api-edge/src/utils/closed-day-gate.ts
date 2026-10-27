import { BadRequest } from '@feathersjs/errors'
import {
  canApproveClosedDay,
  closedDayStatus,
  locationCalendarDate,
  resolveClosedDayPolicy,
  type ClosedDayLocation,
  type ClosedDayPolicyValue,
  type ClosedDayStatus,
  type LocationScopedHourException,
} from '@panary/locations/domain'
import { AppError } from '@panary/shared-common'
import { logger } from '@panary/shared-backend'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Feathers context.app hat generischen Typ Application<any, any>
type FeathersApp = any

/**
 * Ruhetag-Gate des Edge (panary/panary-core#1133, ADR 0062).
 *
 * Eine Stelle für alle Konsumenten — Order-Anlage, Kassieren, Auto-Rotation und
 * die Freigabe selbst —, damit sie am selben Kalendertag dasselbe Urteil fällen.
 */

export interface ClosedDayCheck {
  status: ClosedDayStatus
  policy: ClosedDayPolicyValue
}

/** Minimale Sicht auf die Location, die das Gate liest. */
export type ClosedDayGateLocation = ClosedDayLocation & {
  _id: string
  tenantId?: string
  operationMode?: string | null
}

/** Die Freigabe-Felder eines Geschäftstags. */
export interface ClosedDayApprovalFields {
  openedOnClosedDayBy?: string | null
  openedOnClosedDayRole?: string | null
  openedOnClosedDayAt?: string | null
  openedOnClosedDayDate?: string | null
}

/**
 * Ist heute laut Öffnungszeiten Ruhetag? Lädt dafür nur die Ausnahmen des heutigen
 * Datums dieser Filiale.
 *
 * Fail-open: Sind die Ausnahmen nicht lesbar, liefert die Funktion `null` und loggt
 * `business_day.closed_day_check_skipped`. Eine Kasse, die wegen eines Lesefehlers
 * steht, ist operativ schlimmer als ein Verkauf ohne Freigabe — und der Verkauf
 * selbst wird weiter mit TSE aufgezeichnet.
 */
export async function loadClosedDayCheck(
  app: FeathersApp,
  location: ClosedDayGateLocation,
  now: Date = new Date(),
): Promise<ClosedDayCheck | null> {
  const policy = resolveClosedDayPolicy(location)

  // Ohne aktive Öffnungszeiten gibt es kein Urteil — und keinen Grund für den Read.
  if (location.settings?.openingHoursSettings?.enabled !== true) {
    return { status: closedDayStatus(location, [], now), policy }
  }

  const date = locationCalendarDate(location, now)
  let exceptions: LocationScopedHourException[]
  try {
    // Filialgenau und mit `paginate: false` wie im Vorbestellungs-Hook
    // (`validate-opening-hours.hook.ts`, panary/panary-core#282/#286).
    const result = await app.service('opening-hour-exceptions').find({
      query: { date, locationId: location._id },
      paginate: false,
      provider: undefined,
    })
    exceptions = (Array.isArray(result) ? result : (result?.data ?? [])) as LocationScopedHourException[]
  } catch (err) {
    logger.warn({
      message: 'Ruhetag-Pruefung uebersprungen — Oeffnungszeiten-Ausnahmen nicht lesbar',
      event: 'business_day.closed_day_check_skipped',
      locationId: location._id,
      date,
      error: (err as Error).message,
    })
    return null
  }

  return { status: closedDayStatus(location, exceptions, now), policy }
}

/** Trägt der Geschäftstag eine Freigabe, die heute unter der Regel des Standorts gilt? */
export function hasClosedDayApproval(
  businessDay: ClosedDayApprovalFields | null | undefined,
  date: string,
  policy: ClosedDayPolicyValue,
): boolean {
  if (!businessDay || businessDay.openedOnClosedDayDate !== date) return false
  return canApproveClosedDay(policy, businessDay.openedOnClosedDayRole)
}

/**
 * Meldung im Vokabular der Betriebsart (panary-cloud ADR 0037): Im Bestellbetrieb
 * wird nicht „verkauft", sondern Bestellungen werden angenommen.
 */
export function closedDayMessage(date: string, policy: ClosedDayPolicyValue, operationMode?: string | null): string {
  const what = operationMode === 'orders-only' ? 'Bestellungen annehmen' : 'verkaufen'
  const who = policy === 'block' ? 'dem Inhaber' : 'einem Manager oder dem Inhaber'
  return `Laut Öffnungszeiten ist heute (${date}) geschlossen. Sie können erst nach Freigabe mit der PIN von ${who} ${what}.`
}

/** 400 `LOCATION_CLOSED_TODAY` mit den Angaben, die der POS für den Dialog braucht. */
export function closedDayError(check: ClosedDayCheck, operationMode?: string | null): BadRequest {
  return new BadRequest(closedDayMessage(check.status.date, check.policy, operationMode), {
    code: AppError.LOCATION_CLOSED_TODAY,
    date: check.status.date,
    policy: check.policy,
  })
}

/**
 * Wirft `LOCATION_CLOSED_TODAY`, wenn heute Ruhetag ist und der Geschäftstag, dem
 * die Bestellung zugeordnet würde, keine heute gültige Freigabe trägt. Ohne
 * Geschäftstag gibt es nichts freizugeben — dann wirft sie ebenso, die Freigabe
 * eröffnet den Tag (`approveClosedDay`).
 */
export async function assertClosedDayApproved(
  app: FeathersApp,
  location: ClosedDayGateLocation,
  check: ClosedDayCheck | null,
  businessDayId: string | null | undefined,
): Promise<void> {
  if (!check || check.status.state !== 'closed') return

  if (businessDayId) {
    const businessDay = (await app.service('businessdays').get(businessDayId, {
      provider: undefined,
    })) as ClosedDayApprovalFields
    if (hasClosedDayApproval(businessDay, check.status.date, check.policy)) return
  }

  logger.info({
    message: 'Ruhetag ohne Freigabe — Vorgang abgelehnt',
    event: 'business_day.closed_day_rejected',
    locationId: location._id,
    businessDayId: businessDayId ?? null,
    date: check.status.date,
    policy: check.policy,
    reason: check.status.reason,
  })
  throw closedDayError(check, location.operationMode)
}
