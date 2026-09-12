// Boot-Check: Kommt ueberhaupt noch jemand herein, der Nutzer verwalten kann?
//
// Der Fall, den das meldet (panary/panary-core#275): Auf einem Bestands-Edge
// stand das einzige `tenant:owner`-Konto seit dem Initial-Pull nach dem Pairing
// auf `ARCHIVED` — folgenlos, solange `status` am Edge nur ein Anzeigefeld war.
// Mit dem Login-Guard aus #187 (ausgerollt in v26.8.18) wurde daraus ein
// Totalausschluss: jeder Anmeldeversuch 401, und ohne ein zweites Konto mit
// `users: MANAGE` bleibt nur SSH + SQLite. Aufgefallen ist es dem Kunden, nicht
// uns — drei Wochen nachdem der Schaden angelegt wurde.
//
// Der Check ist deshalb bewusst eine MELDUNG und keine Selbstheilung: Wer beim
// Start automatisch Zugang vergibt, macht `ARCHIVED` fuer die maechtigste Rolle
// dauerhaft wirkungslos (abgestimmt 2026-09-12). Die einmalige Heilung von
// Bestandsdaten laeuft als Migration, nicht hier.
//
// Zwei Eigenschaften, die den Check erst aussagekraeftig machen:
//
//   1. **Dieselbe Semantik wie der Login-Guard.** „Anmeldefaehig" ist genau
//      `!isLoginBlockedByStatus(user)` — inklusive der Regel, dass ein
//      FEHLENDER Status durchlaesst. Eine eigene Status-Logik hier wuerde in
//      dem Moment falsch melden, in dem der Guard sich aendert.
//   2. **Dieselbe Rollen-Wahrheit wie die Matrix.** `USER_MANAGE_ROLES` ist aus
//      `RolePermissions` abgeleitet (@panary/users/domain) — keine vierte Kopie
//      der Rollenliste, das war der Defekt aus #275.
import { canManageUsers, UserStatus } from '@panary/users/domain'
import { logger } from '@panary/shared-backend'

import { isLoginBlockedByStatus } from './user-login-status'

import type { Application } from '../declarations'

/** Minimaler Ausschnitt eines Nutzer-Datensatzes fuer die Bewertung. */
export interface AdminAccessCandidate {
  _id?: string
  loginname?: string | null
  role?: string | null
  status?: string | null
}

/** Ein Verwaltungskonto, das der Login-Guard sperrt — der heilbare Fall. */
export interface BlockedAdminAccount {
  _id?: string
  loginname?: string | null
  role?: string | null
  status?: string | null
}

export interface AdminAccessState {
  /** Mindestens ein Konto kann sich anmelden UND Nutzer verwalten. */
  healthy: boolean
  /** Anzahl anmeldefaehiger Konten mit `users: MANAGE`. */
  usableCount: number
  /** Konten mit `users: MANAGE`, die der Status-Guard sperrt. */
  blocked: BlockedAdminAccount[]
}

/**
 * Reine Bewertung — ohne Feathers, ohne DB. Ein Konto zaehlt, wenn seine Rolle
 * laut Matrix `users: MANAGE` traegt und der Login-Guard es durchlaesst.
 */
export const evaluateAdminAccess = (candidates: readonly AdminAccessCandidate[]): AdminAccessState => {
  const admins = candidates.filter(candidate => canManageUsers(candidate.role))
  const usable = admins.filter(candidate => !isLoginBlockedByStatus(candidate))
  const blocked = admins
    .filter(candidate => isLoginBlockedByStatus(candidate))
    .map(({ _id, loginname, role, status }) => ({ _id, loginname, role, status }))

  return { healthy: usable.length > 0, usableCount: usable.length, blocked }
}

/**
 * Liest die Verwaltungskonten und bewertet sie. `null` heisst „nicht
 * ermittelbar" (DB-Fehler, Tabelle fehlt) — bewusst nicht `healthy: false`:
 * Ein Lesefehler ist kein Nachweis fuer einen fehlenden Zugang, und ein
 * Fehlalarm an dieser Stelle ist teurer als eine Luecke in der Meldung.
 */
export const readAdminAccessState = async (app: Application): Promise<AdminAccessState | null> => {
  try {
    // Interner Aufruf: kein `provider`, damit Query-Scoping und Auth nicht
    // greifen (es gibt hier keinen Akteur). Ueber die Adapter-API statt roh —
    // CLAUDE.md, kein Knex im Request-Pfad.
    const result = await app.service('users').find({
      provider: undefined,
      paginate: false,
      query: { $select: ['_id', 'loginname', 'role', 'status'], $limit: 500 },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)
    const list = (Array.isArray(result) ? result : (result?.data ?? [])) as AdminAccessCandidate[]
    return evaluateAdminAccess(list)
  } catch (err) {
    logger.warn({
      message: 'Admin-Zugang nicht pruefbar — users-Abfrage fehlgeschlagen',
      event: 'bootstrap.admin_access_check_failed',
      errorMessage: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * Boot-Meldung. Laut, wenn kein administrationsfaehiger Zugang mehr existiert —
 * mit den gesperrten Konten im Log, damit ein Techniker weiss, was zu
 * reaktivieren ist. Wirft nie: Ein Boot-Abbruch nimmt dem Betrieb die Kasse
 * und aendert am Zugangsproblem nichts.
 */
export const assertAdminAccessAvailable = async (app: Application): Promise<AdminAccessState | null> => {
  const state = await readAdminAccessState(app)
  if (!state) return null

  if (state.healthy) {
    logger.debug({
      message: `Admin-Zugang vorhanden (${state.usableCount} anmeldefaehige Verwaltungskonten)`,
      event: 'bootstrap.admin_access_ok',
      usableCount: state.usableCount,
      blockedCount: state.blocked.length,
    })
    return state
  }

  logger.error({
    message:
      'KEIN administrationsfaehiger Zugang: Es existiert kein anmeldefaehiges Konto mit Nutzer-Verwaltungsrecht. ' +
      'Der Edge ist ohne DB-Eingriff nicht mehr administrierbar.',
    event: 'bootstrap.admin_access_missing',
    usableCount: 0,
    blockedCount: state.blocked.length,
    blocked: state.blocked.map(account => ({
      loginname: account.loginname ?? null,
      role: account.role ?? null,
      status: account.status ?? null,
    })),
    hint: `Reaktivieren: PATCH /users/<id> { "status": "${UserStatus.ACTIVE}" }`,
  })
  return state
}
