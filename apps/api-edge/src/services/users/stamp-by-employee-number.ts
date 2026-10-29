// Stempeln per Personalnummer am Edge (panary/panary-core#1197).
//
// Am Login-Bildschirm des POS stempelt man nur mit der 6-stelligen Nummer, ohne PIN (Kueche ohne POS-Zugang). Der
// Weg bleibt, wird aber serverseitig geprueft: Mandanten-, geraete-, status- und rollengescoped, durch einen
// Fehlversuchs-Limiter gegen Durchprobieren geschuetzt und mit EINER Ablehnung fuer alle Gruende. Die Nummer
// loest der Server auf; das Panel bekommt nur Vorname und Initial der Bestaetigung.
//
// Die Bestaetigung ist kein Token: `lookupByEmployeeNumber` und `stampByEmployeeNumber` loesen beide neu auf.
import { BadRequest, Forbidden, TooManyRequests } from '@feathersjs/errors'

import { logger } from '@panary/shared-backend'
import { UserSystemRole } from '@panary/users/domain'

import { deviceStampLimiter, EDGE_STAMP_KEY, edgeStampLimiter } from '../../utils/stamp-attempt-limiter'
import { checkTimeClockRequest, type TimeClockActor, type TimeClockTarget } from './time-clock-scope'

import type { Application } from '../../declarations'
import type { User } from './users.class'

export const STAMP_ACTIONS = ['checkin', 'checkout', 'startBreak', 'endBreak'] as const
export type StampAction = (typeof STAMP_ACTIONS)[number]

/** Stabile Codes im `data` des Fehlers — Clients unterscheiden daran, nicht am Text. */
export const STAMP_NUMBER_REJECTED = 'STAMP_NUMBER_REJECTED'
export const STAMP_LOCKED = 'STAMP_LOCKED'

/** Die eine Meldung fuer jeden Ablehnungsgrund — jede Unterscheidung waere ein Orakel fuer die Nummer. */
const REJECTED_MESSAGE = 'Personalnummer ungueltig oder nicht zulaessig.'

/**
 * Nummer allein reicht nur fuer Mitarbeiter. Leitungskonten (Inhaber, Filialleiter, Techniker) und Plattform-Rollen
 * stempeln mit PIN/Bediener-Token. Allowlist statt Sperrliste: Eine kuenftige Rolle ist per Nummer nicht stempelbar,
 * bis jemand sie bewusst aufnimmt. Individuelle `permissions` aendern daran nichts.
 */
const NUMBER_STAMPABLE_ROLES: ReadonlySet<string> = new Set([UserSystemRole.TENANT_STAFF])

const EMPLOYEE_NUMBER_PATTERN = /^\d{6}$/

/** Params-Ausschnitt der neuen Methoden. Ein mitgeschicktes Bediener-Token wird bewusst nicht ausgewertet. */
export type StampByNumberParams = {
  user?: TimeClockActor
  deviceAccessScope?: string[] | null
}

const isDeviceActor = (actor: TimeClockActor | undefined): actor is TimeClockActor & { _id: string } =>
  Boolean(actor?._id && actor.role?.startsWith('device:'))

const lockedError = (seconds: number) =>
  new TooManyRequests(`Zu viele Fehlversuche. Bitte in ${seconds} Sekunden erneut versuchen.`, {
    code: STAMP_LOCKED,
    retryAfterSeconds: seconds,
  })

/** Wartezeit der strengeren der beiden Sperren (Geraet, Edge gesamt) oder `null`. */
const currentLockout = (deviceKey: string): number | null => {
  const device = deviceStampLimiter.lockoutSeconds(deviceKey)
  const edge = edgeStampLimiter.lockoutSeconds(EDGE_STAMP_KEY)
  if (device === null) return edge
  if (edge === null) return device
  return Math.max(device, edge)
}

const reject = (deviceKey: string, reason: string, targetId?: string): never => {
  const deviceFailures = deviceStampLimiter.recordFailure(deviceKey)
  edgeStampLimiter.recordFailure(EDGE_STAMP_KEY)
  const lockedFor = currentLockout(deviceKey)
  // Weder die Nummer noch der gefundene Name gehoeren ins Log — nur Geraet, Grund und Zaehler.
  logger.warn({
    message: 'Stempeln per Personalnummer abgelehnt',
    event: lockedFor === null ? 'security.stamp_number_rejected' : 'security.stamp_number_locked',
    deviceId: deviceKey,
    reason,
    entityId: targetId,
    deviceFailures,
    lockedForSeconds: lockedFor ?? undefined,
  })
  throw new Forbidden(REJECTED_MESSAGE, { code: STAMP_NUMBER_REJECTED })
}

export interface ResolvedStampTarget {
  user: User
  actor: TimeClockActor & { _id: string }
  deviceKey: string
}

/**
 * Gemeinsamer Auflosungsweg beider Methoden: Eingabe pruefen, Sperre pruefen, Nummer im eigenen Mandanten
 * aufloesen, Prufkette durchlaufen. Jede Verletzung endet in derselben Ablehnung und zaehlt einen Fehlversuch.
 */
export const resolveStampTarget = async (
  app: Application,
  employeeNumber: unknown,
  params: StampByNumberParams | undefined,
): Promise<ResolvedStampTarget> => {
  const actor = params?.user

  // Format ist keine Auskunft ueber vorhandene Nummern: kein Fehlversuch, keine Einheitsmeldung.
  if (typeof employeeNumber !== 'string' || !EMPLOYEE_NUMBER_PATTERN.test(employeeNumber)) {
    throw new BadRequest('employeeNumber muss aus genau 6 Ziffern bestehen')
  }

  // Kein Geraet: abweisen, bevor ein Zaehler beruehrt wird. Sonst koennte jeder Aufrufer mit `users:UPDATE` die
  // Edge-weite Sperre ausloesen und damit alle Kassen lahmlegen.
  if (!isDeviceActor(actor)) {
    logger.warn({
      message: 'Stempeln per Personalnummer von Nicht-Geraet abgelehnt',
      event: 'security.stamp_number_not_device',
    })
    throw new Forbidden(REJECTED_MESSAGE, { code: STAMP_NUMBER_REJECTED })
  }
  const deviceKey = actor._id

  const lockedFor = currentLockout(deviceKey)
  if (lockedFor !== null) throw lockedError(lockedFor)

  // Mandant ist Pflicht: Ohne ihn gaebe es keinen Scope fuer die Suche. Fail-closed.
  if (!actor.tenantId) return reject(deviceKey, 'NO_TENANT_CONTEXT')

  // `provider: undefined` scoped nicht — der Mandant steht deshalb ausdruecklich in der Query. Zwei Treffer
  // (Nummer nicht eindeutig, Altbestand) werden wie keiner behandelt, statt einen davon zu raten.
  const found = (await app.service('users').find({
    query: { employeeNumber, tenantId: actor.tenantId, $limit: 2 },
    paginate: false,
    provider: undefined,
  })) as unknown as User[]
  if (found.length !== 1) return reject(deviceKey, found.length === 0 ? 'UNKNOWN_NUMBER' : 'AMBIGUOUS_NUMBER')
  const user = found[0]

  if (!user.role || !NUMBER_STAMPABLE_ROLES.has(user.role)) return reject(deviceKey, 'ROLE_NOT_ALLOWED', user._id)

  // Bewusst `checkTimeClockRequest` und nicht `assertTimeClockAccess`: Letzteres wirft je Verletzung eine eigene
  // Meldung. Kein `posOperator` — dieser Pfad ist der token-lose.
  const violation = checkTimeClockRequest(actor, user as TimeClockTarget, {
    deviceAccessScope: params?.deviceAccessScope ?? null,
  })
  if (violation) return reject(deviceKey, violation.reason, user._id)

  return { user, actor, deviceKey }
}

/** Zustand nach der Buchung, abgeleitet vom Datensatz. */
export const stampStateOf = (user: Pick<User, 'stampingId' | 'startBreakAt'>): 'OUT' | 'IN' | 'BREAK' => {
  if (!user.stampingId) return 'OUT'
  return user.startBreakAt ? 'BREAK' : 'IN'
}

export const isStampAction = (value: unknown): value is StampAction =>
  typeof value === 'string' && (STAMP_ACTIONS as readonly string[]).includes(value)

export const clearDeviceStampFailures = (deviceKey: string): void => deviceStampLimiter.clear(deviceKey)
