// Eigentums-Pruefung fuer Custom Methods (panary/panary-core#357).
//
// ## Warum es das braucht
//
// Eine Custom Method (`convert`, `checkin`, `verifyPin`, `discardOrphanDay`, …)
// bekommt eine fremde ID herein und laedt den Datensatz intern
// (`{ provider: undefined }`). Keine der drei Schutzschichten greift dabei:
//
//   - `multiTenancy` schaltet ausschliesslich auf `create`/`update`/`patch`
//     (Stamping) und `find`/`get`/`remove`/`update`/`patch` (Scoping). Ein
//     Methodenname wie `convert` trifft KEINE der beiden Listen — der Hook ist
//     fuer Custom Methods ein vollstaendiger No-Op, obwohl er in `around.all`
//     registriert ist und dort wie ein Schutz aussieht.
//   - Der innere `get` mit `{ provider: undefined }` schaltet den Mandantenfilter
//     per Definition ab (interne Aufrufe sind ungescoped).
//   - `ensureTenantIsolation` ist ein App-Level-*after*-Hook. Er prueft das
//     Ergebnis und kommt damit zu spaet — und wenn die Methode den Datensatz
//     unterwegs auf den Aufrufer umstempelt, sieht er ueberhaupt keinen
//     Unterschied mehr.
//
// An `pre-orders.convert()` gemessen (2026-09-22, Angreifer `tenant:staff`,
// Stand vor dem Fix): Eine fremde Vorbestellungs-ID antwortete mit **HTTP 200**,
// legte eine Order mit den **fremden** `lineItems` an — gestempelt auf den
// **eigenen** Mandanten, also fuer den Aufrufer lesbar — setzte deren
// `locationId` auf die **fremde** Filiale und markierte die fremde
// Vorbestellung als `CONVERTED`. Kein Fehler, kein Alarm.
//
// ## Warum geteilt statt app-lokal
//
// Dieselbe Pruefung existierte vorher dreimal in leicht verschiedener Form
// (`time-clock-scope.ts` #189, `verifyPin`/`changePin` #332, `business-days.ts`)
// und fehlte an der vierten Stelle. Eine vierte Handschrift haette das Muster
// fortgesetzt statt es zu beenden.
//
// ⚠️ Die Gegenentscheidung von #189 ist bekannt: Damals blieb der Scope bewusst
// app-lokal, weil ein geteilter Helfer aus einem Sicherheitsfix eine Kette ueber
// beide Repos macht (Lib-Aenderung → Core-Release → Cloud-Pin-Bump → Cloud-Umbau).
// Das gilt weiterhin — hier ist die Kette Absicht: Der Cloud-Zwilling
// (`api-cloud/.../pre-orders.class.ts`) traegt denselben Defekt, und dort ist er
// UNBEDINGT erreichbar, weil alle Mandanten in derselben MongoDB liegen. Am Edge
// braucht es dagegen eine gemischte Mandanten-Historie aus Re-Pairing;
// `pre-orders` wird gar nicht gesynct.

import { Forbidden } from '@feathersjs/errors'

export type OwnershipActor = {
  _id?: string
  role?: string | null
  tenantId?: string | null
}

export type OwnershipTarget = {
  tenantId?: string | null
}

export type OwnershipViolation = {
  reason: 'NO_TENANT_CONTEXT' | 'FOREIGN_TENANT'
  message: string
}

export type OwnershipOptions = {
  /**
   * Einen authentifizierten Aufrufer OHNE `tenantId` durchlassen, statt ihn
   * abzuweisen. Default `false`.
   *
   * 🚨 Nur setzen, wenn eine **benannte** legitime Konstellation existiert — und
   * sie an der Aufrufstelle hinschreiben. Es gibt genau eine bekannte: der
   * virtuelle Geraete-User **vor dem Pairing** (`device:*` ohne Mandant), der am
   * POS stempeln koennen muss, bevor der Edge einem Mandanten zugeordnet ist.
   * Das ist keine Nachlaessigkeit der alten Fassung gewesen, sondern Absicht —
   * gemessen an `time-clock-scope.spec.ts`.
   *
   * Ueberall sonst ist ein Aufrufer ohne Mandant der unklarste Fall und gehoert
   * abgewiesen. Wer diese Option „zur Sicherheit" setzt, dreht den Schutz ab.
   */
  allowMissingTenantContext?: boolean
}

/**
 * Darf `actor` auf `target` arbeiten? `null` = ja.
 *
 * Reine Entscheidung ohne Feathers, damit die Sicherheitszusage unmittelbar
 * testbar ist (Muster: `time-clock-scope.ts`).
 *
 * Drei Faelle, in dieser Reihenfolge:
 *
 * 1. **Kein Aufrufer** → durchlassen. Interne Aufrufe (`{ provider: undefined }`
 *    aus Sync, Seed, Migration, Worker) tragen keinen User; sie hier abzuweisen
 *    wuerde den halben Server lahmlegen. Dieselbe Regel wie in `multiTenancy`
 *    und `ensureTenantIsolation`.
 * 2. **Plattform-Rolle** → durchlassen. `platform:*` sieht mandantenuebergreifend,
 *    wortgleich zu `ensureTenantIsolation`.
 * 3. **Alles andere** → der Mandant muss uebereinstimmen.
 *
 * 🚨 Punkt 3 ist bewusst **fail-closed**: Ein Aufrufer ohne `tenantId`, der keine
 * Plattform-Rolle traegt, wird ABGEWIESEN, nicht durchgelassen. Die bisherigen
 * Fassungen schrieben `if (actor.tenantId && target.tenantId !== actor.tenantId)`
 * — und prueften damit genau dann nicht, wenn der Mandantenkontext fehlte, also
 * im unklarsten Fall. Wer den Helfer wieder auf die bedingte Form zurueckdreht,
 * baut diese stille Luecke erneut ein.
 *
 * ⚠️ Eine benannte Ausnahme gibt es: `allowMissingTenantContext` — siehe dort.
 * Der virtuelle Geraete-User vor dem Pairing traegt legitim keinen Mandanten.
 * Die alte bedingte Form war an dieser einen Stelle also Absicht, nicht
 * Nachlaessigkeit; neu ist nur, dass die Ausnahme jetzt dasteht statt sich aus
 * einem `&&` zu ergeben.
 */
export const checkCallerOwnsRecord = (
  actor: OwnershipActor | null | undefined,
  target: OwnershipTarget | null | undefined,
  options: OwnershipOptions = {},
): OwnershipViolation | null => {
  if (!actor) return null
  if (actor.role && actor.role.startsWith('platform:')) return null

  if (!actor.tenantId) {
    if (options.allowMissingTenantContext) return null
    return {
      reason: 'NO_TENANT_CONTEXT',
      message: 'Mandantenkontext fehlt — der Aufruf kann nicht zugeordnet werden.',
    }
  }

  if (!target || target.tenantId !== actor.tenantId) {
    return {
      reason: 'FOREIGN_TENANT',
      message: 'Der Datensatz gehoert nicht zum eigenen Mandanten.',
    }
  }

  return null
}

/**
 * Wie `checkCallerOwnsRecord`, wirft aber `Forbidden` statt zurueckzugeben.
 *
 * **Vor jedem Write aufrufen.** Ein Aufruf danach ist wirkungslos: Feathers rollt
 * nichts zurueck, die Zeile steht dann schon in der Datenbank — und genau das
 * macht `ensureTenantIsolation` als after-Hook wirkungslos.
 */
export function assertCallerOwnsRecord(
  actor: OwnershipActor | null | undefined,
  target: OwnershipTarget | null | undefined,
  options: OwnershipOptions = {},
): void {
  const violation = checkCallerOwnsRecord(actor, target, options)
  if (violation) throw new Forbidden(violation.message, { reason: violation.reason })
}
