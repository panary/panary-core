// Zugriffs-Policy fuer den `users`-Service — Single Source of Truth fuer die
// Frage „welche Rolle darf welche Nutzer-Datensaetze sehen und aendern?".
// Konsumenten: Edge (apps/api-edge) und Cloud (apps/api-cloud), jeweils
// users.schema.ts (Query-Scoping) und restrict-user-self-patch.hook.ts.
//
// Es sind ZWEI Dimensionen, und sie sind nicht deckungsgleich:
//
//   - SEHEN   (`USER_VISIBILITY_ALL_ROLES`) — Query-Scoping im users-Service.
//     Wer nicht drin steht, bekommt `query._id = <eigene Id>`. Weil das auf
//     der Query sitzt, wirkt es fuer `find` UND `get`/`patch` by id.
//   - AENDERN (`PRIVILEGED_ROLES`) — Bypass der PATCH-Self-Restriction.
//     Wer nicht drin steht, darf nur den eigenen Datensatz und darin nur
//     `SELF_PATCHABLE_FIELDS` (siehe self-patch-policy.ts).
//
// 🚨 Warum beide hier und nicht je beim Konsumenten: Bis panary/panary-core#275
// existierten DREI Kopien (Patch-Liste in der Domain, Sicht-Liste je einmal in
// api-edge und api-cloud). Sie liefen auseinander, und zwar in beide
// Richtungen — mit einem Totalausschluss als Folge: `tenant:technician` hatte
// `users: MANAGE` und stand in der Patch-Liste, fehlte aber in der Sicht-Liste.
// Am Kunden-Edge zeigte die Benutzerliste damit 1 von 9 Konten, und ein
// `PATCH /users/<fremde-id>` endete in 404 (nicht 403) — der als Notzugang
// gedachte Techniker konnte einen ausgesperrten Owner nicht reaktivieren.
// Begruendung: docs/adr/0028-archived-sperrt-am-edge.md.
//
// Wer sehen/aendern DARF, entscheidet weiterhin zusaetzlich der authorize-Hook
// ueber die RolePermissions-Matrix. Diese Listen steuern nur den Datenausschnitt.
//
// Entscheidung je Rolle (bewusst getroffen, nicht eingeebnet):
//
//   | Rolle              | sieht alle | aendert alle | Begruendung                                   |
//   |--------------------|------------|--------------|-----------------------------------------------|
//   | platform:owner     | ja         | ja           | struktureller Bypass (Gott-Modus)             |
//   | platform:admin     | ja         | ja           | Cross-Tenant-Support; Matrix begrenzt auf READ |
//   | platform:support   | ja         | ja           | wie platform:admin                            |
//   | tenant:owner       | ja         | ja           | `users: MANAGE`                               |
//   | tenant:technician  | ja (#275)  | ja           | `users: MANAGE` — gedachter Notzugang         |
//   | tenant:manager     | ja         | NEIN         | braucht die Personalliste (Dienstplan, PIN-    |
//   |                    |            |              | Vergabe-Sicht), patcht aber nur sich selbst    |
//   |                    |            |              | (Entscheidung zu #189, time-clock-scope.ts)    |
//   | tenant:staff       | nein       | nein         | Self-Service, sieht nur sich                  |
//   | device:*           | Sonderpfad | nein         | Geraete-Zuweisungs-Scope in users.schema.ts    |
//
// Die Invarianten-Tests in user-access-policy.spec.ts locken das gegen die
// RolePermissions-Matrix — insbesondere, dass „aendern" eine Teilmenge von
// „sehen" bleibt. Genau diese Invariante war der Defekt aus #275.

import { AppAction, AppResource } from './permissions'
import { RolePermissions, type PermissionRule } from './roles.matrix'
import { UserSystemRole } from './user.schema'

/**
 * Rollen, die die PATCH-Self-Restriction umgehen — sie duerfen jeden Nutzer
 * und darin jedes Feld aendern.
 *
 * ⚠️ Auch Konsument in `time-clock-scope.ts` (wer fuer andere stempeln darf) —
 * Mitgliedschaft also nicht nur unter dem Patch-Aspekt aendern.
 */
export const PRIVILEGED_ROLES: ReadonlySet<string> = new Set<string>([
  UserSystemRole.PLATFORM_OWNER,
  UserSystemRole.PLATFORM_ADMIN,
  UserSystemRole.PLATFORM_SUPPORT,
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_TECHNICIAN,
])

/**
 * Rollen, die die vollstaendige Nutzerliste sehen duerfen. Alle anderen
 * (ausser `device:*`, die einen eigenen Zuweisungs-Pfad haben) werden im
 * Query-Resolver auf die eigene `_id` eingeschraenkt.
 */
export const USER_VISIBILITY_ALL_ROLES: ReadonlySet<string> = new Set<string>([
  UserSystemRole.PLATFORM_OWNER,
  UserSystemRole.PLATFORM_ADMIN,
  UserSystemRole.PLATFORM_SUPPORT,
  UserSystemRole.TENANT_OWNER,
  UserSystemRole.TENANT_MANAGER,
  UserSystemRole.TENANT_TECHNICIAN,
])

/** Darf die Rolle die vollstaendige Nutzerliste sehen? */
export const canSeeAllUsers = (role: string | undefined): boolean => !!role && USER_VISIBILITY_ALL_ROLES.has(role)

/** Darf die Rolle fremde Nutzer-Datensaetze aendern? */
export const canPatchAnyUser = (role: string | undefined): boolean => !!role && PRIVILEGED_ROLES.has(role)

const hasUsersManage = (rules: readonly PermissionRule[]): boolean =>
  rules.some(
    rule =>
      typeof rule === 'object' &&
      'resource' in rule &&
      rule.resource === AppResource.USERS &&
      (Array.isArray(rule.action) ? rule.action : [rule.action]).includes(AppAction.MANAGE),
  )

/**
 * Rollen, denen die RolePermissions-Matrix `users: MANAGE` gibt — also die
 * Rollen, mit denen ein Konto andere Nutzer verwalten (und damit ein
 * faelschlich archiviertes reaktivieren) kann.
 *
 * Bewusst ABGELEITET statt gelistet: Eine vierte handgepflegte Kopie waere
 * genau der Fehler, den #275 behoben hat. Der Boot-Check in api-edge
 * (`utils/admin-access-health.ts`) prueft damit, ob ueberhaupt noch ein
 * administrationsfaehiges Konto anmeldefaehig ist.
 */
export const USER_MANAGE_ROLES: ReadonlySet<string> = new Set<string>(
  Object.entries(RolePermissions)
    .filter(([, rules]) => hasUsersManage(rules))
    .map(([role]) => role),
)

/** Darf die Rolle andere Nutzer verwalten (`users: MANAGE` laut Matrix)? */
export const canManageUsers = (role: string | undefined | null): boolean => !!role && USER_MANAGE_ROLES.has(role)
