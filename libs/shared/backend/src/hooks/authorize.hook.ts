import { HookContext, NextFunction } from '../declarations'
import { Forbidden } from '@feathersjs/errors'
import {
  AppAbility,
  AppAction,
  AppResource,
  hasEffectiveAbility,
  hasEffectivePermission,
  UserSystemRole,
} from '@panary/users/domain'
import { AppError, AppErrorMessages } from '@panary/shared-common'
import { logger } from '../logger'

// 2. SCHICHT: Hybrid-RBAC — Rolle (Matrix) ODER additiver Pro-User-Grant.
// Die Auswertung laeuft ueber `hasEffectivePermission` aus @panary/users/domain
// und ist damit dieselbe Quelle der Wahrheit wie im Cloud-authorize-Hook.
//
// Bewusste Unterschiede zur alten Edge-Implementierung (Stufe 3.2, 2026-07):
//  - `user.permissions` (grant:<resource>:<action>) wird jetzt DURCHGESETZT —
//    vorher prüfte der Edge nur die Rollen-Matrix, vergebene Grants waren
//    am Edge wirkungslos.
//  - Die SYSTEM-Matrix-Regel wirkt NICHT mehr als Wildcard über alle
//    Ressourcen (Cloud-Semantik). Kompensiert durch explizite Matrix-Einträge
//    (TENANT_TECHNICIAN: fiscal-counters/log-export/organisations READ).
//  - Unbekannte Custom-Methods fallen nicht mehr still auf READ zurück,
//    sondern auf den Methodennamen als Action — das matcht nur MANAGE-Regeln.

// Explizites Mapping Feathers-Methode/Custom-Method → AppAction.
// Jede neue Edge-Custom-Method MUSS hier eingetragen werden — sonst greift
// der MANAGE-only-Fallback und alle Nicht-MANAGE-Rollen bekommen 403.
const METHOD_TO_ACTION: Record<string, AppAction> = {
  find: AppAction.READ,
  get: AppAction.READ,
  create: AppAction.CREATE,
  update: AppAction.UPDATE,
  patch: AppAction.UPDATE,
  remove: AppAction.DELETE,
  // pre-orders: `convert` patcht die Vorbestellung → CONVERTED und legt die
  // Order an (Order-CREATE wird separat über orders autorisiert) — identisch
  // zum Cloud-Hook.
  convert: AppAction.UPDATE,
  // businessdays: Tagesabschluss-Custom-Methods am Edge.
  openDay: AppAction.CREATE,
  closeDay: AppAction.UPDATE,
  refreshClosingStatus: AppAction.UPDATE,
  // businessdays: entfernt einen verwaisten, leeren Geschaeftstag — echtes
  // DELETE, damit nur Rollen mit Loeschrecht es duerfen (nicht der
  // MANAGE-Fallback fuer unbekannte Custom-Methods).
  discardOrphanDay: AppAction.DELETE,
  // sync-outbox (REV-Sync): modifiziert den Workflow-State
  // (rejected → pending + neuer Eintrag), daher UPDATE.
  reEnqueue: AppAction.UPDATE,
  // users (POS-Zeiterfassung): verifyPin liest nur (PIN-Check ohne
  // State-Change) → READ. checkin/checkout/startBreak/endBreak ändern
  // User + working-times → UPDATE (Cloud-Semantik); Geräte-Rollen ohne
  // users:UPDATE laufen alternativ über die CAN_CLOCK_IN-Ability (s. u.).
  verifyPin: AppAction.READ,
  // changePin setzt einen neuen posPin-Hash → UPDATE. Rollen mit users:UPDATE
  // (TENANT_STAFF/MANAGER) duerfen es damit regulaer; Geraete-Rollen laufen
  // ueber die CAN_CHANGE_POS_PIN-Ability (s. u.).
  changePin: AppAction.UPDATE,
  checkin: AppAction.UPDATE,
  checkout: AppAction.UPDATE,
  startBreak: AppAction.UPDATE,
  endBreak: AppAction.UPDATE,
  // cash-sessions: autorisierte Eröffnung (Manager-PIN) legt eine Session an.
  openAuthorized: AppAction.CREATE,
  // cloud-connection: preflight ist reine Diagnose (READ); startBootstrap und
  // syncNow mutieren den Pairing-/Sync-State → UPDATE.
  preflight: AppAction.READ,
  startBootstrap: AppAction.UPDATE,
  syncNow: AppAction.UPDATE,
  setEmergencyOverride: AppAction.UPDATE,
}

// users-Zeiterfassung: DEVICE_POS/DEVICE_TABLET stempeln Mitarbeiter über das
// Geräte-JWT und haben bewusst KEIN users:UPDATE (das würde beliebige
// User-Patches erlauben). Für genau diese vier Methoden genügt alternativ die
// fachliche CAN_CLOCK_IN-Ability (Matrix-String oder user.permissions).
const TIME_CLOCK_METHODS: ReadonlySet<string> = new Set(['checkin', 'checkout', 'startBreak', 'endBreak'])

// users-PIN-Selbstwechsel: DEVICE_POS/DEVICE_TABLET rufen `changePin` ueber das
// Geraete-JWT auf und haben bewusst KEIN users:UPDATE. Eigenes Set statt
// TIME_CLOCK_METHODS zu erweitern — sonst wuerde CAN_CLOCK_IN plaetzlich auch
// PIN-Wechsel autorisieren (Invarianten-Test in authorize.hook.spec.ts).
// Die Ability autorisiert nur das GERAET; die Bindung an den Mitarbeiter
// leistet der currentPin-Beweis innerhalb der Methode.
const PIN_CHANGE_METHODS: ReadonlySet<string> = new Set(['changePin'])

// SQLite speichert `permissions` als JSON-Text. Die users-After-Hooks parsen
// das Feld normalerweise schon — defensiv trotzdem normalisieren, damit ein
// un-geparster String weder crasht noch still als „keine Grants" durchgeht.
const normalizePermissions = (raw: unknown): readonly string[] | undefined => {
  if (Array.isArray(raw)) return raw.filter((entry): entry is string => typeof entry === 'string')
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : undefined
    } catch {
      return undefined
    }
  }
  return undefined
}

export const authorize = () => async (context: HookContext, next: NextFunction) => {
  // 1. Interne Aufrufe durchlassen (kein Provider = Systemaufruf)
  if (!context.params.provider) return next()

  // 2. User prüfen (muss authentifiziert sein)
  const { user } = context.params
  if (!user)
    throw new Forbidden(AppErrorMessages[AppError.TENANT_MISMATCH], {
      code: AppError.TENANT_MISMATCH,
    })

  // 3. PLATFORM OWNER BYPASS (der "Gott-Modus")
  if (user.role === UserSystemRole.PLATFORM_OWNER) {
    return next()
  }

  // 4. Aktion und Ressource bestimmen. Unbekannte Custom-Methods fallen auf
  // den Methodennamen als Action zurück → matcht ausschließlich MANAGE-Regeln.
  const role = user.role as UserSystemRole | undefined
  const permissions = normalizePermissions(user.permissions)
  const resource = context.path
  const method = context.method
  const action = METHOD_TO_ACTION[method] ?? (method as AppAction)

  // 5. Rolle (Matrix) ODER additiver Pro-User-Grant (user.permissions) —
  // geteilte Auswertung mit der Cloud (eine Quelle der Wahrheit).
  let allowed = hasEffectivePermission(role, permissions, resource, action)

  // 6. Zeiterfassungs-Sonderfall: CAN_CLOCK_IN-Ability als Alternative zu
  // users:UPDATE (POS-/Tablet-Geräte stempeln Staff über das Geräte-JWT).
  if (!allowed && resource === AppResource.USERS && TIME_CLOCK_METHODS.has(method)) {
    allowed = hasEffectiveAbility(role, permissions, AppAbility.CAN_CLOCK_IN)
  }

  // 6b. PIN-Selbstwechsel-Sonderfall: CAN_CHANGE_POS_PIN als Alternative zu
  // users:UPDATE (POS-/Tablet-Terminals ohne Mitarbeiter-Session).
  if (!allowed && resource === AppResource.USERS && PIN_CHANGE_METHODS.has(method)) {
    allowed = hasEffectiveAbility(role, permissions, AppAbility.CAN_CHANGE_POS_PIN)
  }

  if (allowed) {
    return next()
  }

  // 7. Zugriff verweigert
  logger.warn({
    message: `[Security] Zugriff verweigert: ${user.role} darf ${action} auf ${resource} nicht`,
    event: 'security.access_denied',
    userId: user._id,
    userRole: user.role,
    resource,
    action,
    service: context.path,
    method: context.method,
  })
  throw new Forbidden('Access denied', {
    code: AppError.AUTH_NO_PERMISSION,
    role: user.role,
    resource: resource,
    action: action,
  })
}
