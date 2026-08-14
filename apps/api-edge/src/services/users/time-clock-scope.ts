// Aufrufer-Scope fuer die POS-Zeiterfassung (panary/panary-core#189).
//
// Die Custom-Methods `checkin`/`checkout`/`startBreak`/`endBreak` bekommen eine
// beliebige `userId` herein und laden den Datensatz intern
// (`provider: undefined`). Damit greift keiner der Hooks, die den `patch`-Pfad
// absichern:
//
//   - `multiTenancy` stempelt/filtert nur Query und Data der Standard-Methoden,
//   - `restrictUserSelfPatch` haengt ausschliesslich am `patch`-Hook,
//   - `restrictDeviceAccessMode` war nur auf `verifyPin`/`changePin` gesetzt,
//   - `ensureTenantIsolation` ist ein App-Level-*after*-Hook: Er prueft das
//     Result und schlaegt damit erst zu, wenn laengst geschrieben wurde.
//
// Am laufenden Edge nachgemessen (Angreifer `tenant:staff`, Stand vor dem Fix):
// `checkin` auf einen Kollegen antwortete mit HTTP 200, legte einen
// `working-times`-Eintrag an und patchte dessen `stampingId` — waehrend ein
// schlichtes `GET /users/<kollege>` demselben Aufrufer 404 liefert. Der
// Lesepfad war gescoped, der Schreibpfad nicht, und die Antwort gab den
// kompletten Kollegen-Datensatz zurueck. Ebenso durch: `startBreak` auf einen
// Kollegen, `checkin` auf ein ARCHIVED-Konto und ein Geraete-JWT auf einen
// Mitarbeiter, der diesem Geraet gar nicht zugewiesen ist.
//
// Diese Datei enthaelt die reine Entscheidung — ohne Feathers, ohne Knex, damit
// die Sicherheitszusagen unmittelbar testbar sind (Muster:
// ../../utils/user-login-status.ts). Bewusst app-lokal statt in
// `@panary/users/domain`, obwohl panary-cloud seit #225 dieselbe Pruefung
// traegt: Der gemeinsame Umzug in die Domain ist eine Kette ueber beide Repos
// (Domain-Aenderung → Core-Release → Cloud-Pin-Bump → Cloud-Umbau) und gehoert
// nicht in einen Sicherheitsfix. Die Rollen-Wahrheit (`PRIVILEGED_ROLES`) kommt
// ohnehin aus der Domain, geteilt ist damit das, was sich aendern koennte.
import { Forbidden } from '@feathersjs/errors'

import { PRIVILEGED_ROLES } from '@panary/users/domain'

import { isLoginBlockedByStatus } from '../../utils/user-login-status'

/** Praefix der Geraete-Rollen (`device:pos-client`, `device:tablet`, …). */
const DEVICE_ROLE_PREFIX = 'device:'

/** Minimal benoetigter Ausschnitt des authentifizierten Aufrufers (`params.user`). */
export interface TimeClockActor {
  _id?: string
  role?: string
  tenantId?: string
}

/** Minimal benoetigter Ausschnitt des Ziel-Datensatzes (der gestempelte Mitarbeiter). */
export interface TimeClockTarget {
  _id?: string
  tenantId?: string | null
  status?: string | null
}

export interface TimeClockViolation {
  reason: 'FOREIGN_TENANT' | 'FOREIGN_RECORD' | 'NOT_ASSIGNED' | 'INACTIVE_ACCOUNT'
  /** Client-stabile Meldung — der Adapter wirft sie unveraendert als Forbidden. */
  message: string
}

export interface TimeClockScopeOptions {
  /**
   * Erlaubter Personenkreis des Geraets, aufgeloest von `resolveDeviceAccessScope`
   * (liegt als `params.deviceAccessScope` bereit, weil der Hook in `before.all`
   * laeuft — er greift auch bei Custom-Methods). `null`/`undefined` = keine
   * Einschraenkung.
   */
  deviceAccessScope?: string[] | null
}

const isDeviceRole = (role: string | undefined): boolean => Boolean(role?.startsWith(DEVICE_ROLE_PREFIX))

/**
 * Kernpruefung des Zeiterfassungs-Zugriffs. Liefert `null`, wenn der Aufruf
 * erlaubt ist, sonst die erste Verletzung.
 *
 * Reihenfolge ist Absicht: Der Mandant zuerst — ein Aufrufer aus einem fremden
 * Tenant soll nicht ueber die Reihenfolge der Ablehnungen erfahren, ob es den
 * Datensatz gibt oder in welchem Stempel-Zustand er ist. Am Edge ist das
 * Tiefenstaffelung statt Hauptlinie (ein Edge gehoert zu genau einem Mandanten),
 * aber genau so haelt es `changePin` in users.ts auch — und ein Bestand aus der
 * Zeit vor dem tenantId-Restamp ist nicht ausgeschlossen.
 *
 * `actor === undefined` (interner Aufruf ohne `params.user`, z.B. Sync) laesst
 * bewusst durch — interne Pfade muessen jeden Datensatz schreiben duerfen,
 * genau wie bei `restrictUserSelfPatch`.
 */
export const checkTimeClockRequest = (
  actor: TimeClockActor | undefined,
  target: TimeClockTarget,
  options: TimeClockScopeOptions = {},
): TimeClockViolation | null => {
  if (!actor) return null

  // 1. Mandanten-Grenze. `multiTenancy` greift bei Custom-Methods nicht —
  // Tenant-Scope deshalb explizit, wortgleich zu changePin.
  if (actor.tenantId && target.tenantId !== actor.tenantId) {
    return {
      reason: 'FOREIGN_TENANT',
      message: 'Benutzer gehoert nicht zum eigenen Mandanten',
    }
  }

  // 2. Fremder Datensatz. Geraete-Rollen duerfen fuer jeden Mitarbeiter
  // stempeln — ein Terminal bedient die ganze Schicht, und genau dafuer gibt es
  // am Edge den CAN_CLOCK_IN-Fallback in authorize.hook.ts. Privilegierte
  // Rollen (Inhaber, Techniker, Plattform) ebenfalls. Alle uebrigen nur sich
  // selbst: `users:UPDATE` haben TENANT_STAFF/TENANT_MANAGER ausschliesslich
  // fuer den Self-Service, den sonst `restrictUserSelfPatch` erzwingt.
  //
  // TENANT_MANAGER ist bewusst NICHT in PRIVILEGED_ROLES (Entscheidung zu #189
  // bestaetigt): Der Filialleiter stempelt Mitarbeiter ueber das Terminal, und
  // das laeuft unter dem Geraete-JWT. Stempel-*Korrekturen* laufen fachlich
  // ueber `working-times`, nicht ueber diese Methoden — konsistent zu changePin.
  const role = actor.role
  if (role && !isDeviceRole(role) && !PRIVILEGED_ROLES.has(role) && actor._id !== target._id) {
    return {
      reason: 'FOREIGN_RECORD',
      message: 'Zeiterfassung ist nur fuer den eigenen Benutzer moeglich.',
    }
  }

  // 3. Geraete-Zuweisung (PNRY-FEAT-DEVICE-ASSIGNMENT-001). An einem
  // zugewiesenen Geraet darf nur der freigegebene Personenkreis stempeln —
  // dieselbe Grenze, die `restrictDeviceAccessMode` fuer verifyPin/changePin
  // zieht. Hier statt im Hook, weil dessen PIN-Tarnung (wortgleiche Meldung +
  // `recordPinFailure`) fuer die Zeiterfassung falsch waere: Sie wuerde den
  // PIN-Lockout eines Kollegen ausloesen, ohne dass je eine PIN im Spiel war.
  const scope = options.deviceAccessScope
  if (Array.isArray(scope) && target._id && !scope.includes(target._id)) {
    return {
      reason: 'NOT_ASSIGNED',
      message: 'Benutzer ist fuer dieses Geraet nicht freigegeben.',
    }
  }

  // 4. Kontostatus — gleiche Sperre wie verifyPin/changePin (#187). Ein
  // archiviertes Konto soll auch nicht mehr bestempelt werden koennen.
  if (isLoginBlockedByStatus(target)) {
    return {
      reason: 'INACTIVE_ACCOUNT',
      message: 'Benutzerkonto ist nicht aktiv.',
    }
  }

  return null
}

/**
 * Feathers-Adapter um [[checkTimeClockRequest]]: wirft `Forbidden`, sonst nichts.
 * Wird in jeder der vier Stempel-Methoden unmittelbar nach dem `get` aufgerufen —
 * also **vor** jedem Schreibvorgang und vor jeder Zustands-Meldung.
 */
export const assertTimeClockAccess = (
  actor: TimeClockActor | undefined,
  target: TimeClockTarget,
  options: TimeClockScopeOptions = {},
): void => {
  const violation = checkTimeClockRequest(actor, target, options)
  if (violation) throw new Forbidden(violation.message)
}
