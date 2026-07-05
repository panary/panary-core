---
title: Effektive Berechtigungen — hasEffectivePermission + Capability-Bundles
date: 2026-06-17
category: Sicherheit
domains: [users]
status: implemented
---

# Effektive Berechtigungen (Helper + Pakete)

Geteilte RBAC-Bausteine in `@panary/users/domain` (seit `v26.7.11`) für das
Hybrid-Modell **„Rolle (Matrix) ODER additiver Pro-User-Grant"**. Konsumiert von
Cloud-Backend (`authorize.hook`, `restrict-permission-grants.hook`),
Cloud-Frontend (`auth.service.can()`) und dem Edge-`users`-Service
(Grant-Escalation-Guard, siehe §4); die Adoption des Helpers im
Edge-`authorize.hook` ist weiterhin P2.

Das vollständige Feature (Escalation-Guard, UI, Pakete-Zuweisung) ist in
[panary-cloud/documentation/granulare-berechtigungen.md](../../panary-cloud/documentation/granulare-berechtigungen.md)
dokumentiert.

## 1. Grant-Format

**Datei:** `libs/domains/users/domain/src/lib/effective-permissions.ts`

Additive Pro-User-Grants liegen im bestehenden `user.permissions: string[]`-Feld
als Strings **`grant:<resource>:<action>`** (eigener `grant:`-Namespace →
kollisionsfrei zu den `can_*`-AppAbility-Strings im selben Array).

```ts
GRANT_PREFIX = 'grant:'
makeGrant(resource, action) // → `grant:incoming-goods:manage`
parseGrant(raw)             // → { resource, action } | null
isValidGrant(raw)           // → boolean
```

- **`parseGrant`** trennt am **letzten** Doppelpunkt (Ressourcen dürfen `/`
  enthalten, z. B. `external/off-lookup`, aber kein `:`). Liefert `null` bei
  Formatfehler **oder** unbekannter Ressource/Aktion (defensiv: getippte/unbekannte
  Grants gewähren nie Zugriff). `<resource>` ∈ `AppResource`, `<action>` ∈
  `AppAction`.
- Reserviert bewusst Raum für ein künftiges `deny:`-Präfix **ohne
  Schema-Migration** (nicht gebaut).

## 2. Der eine Evaluator

```ts
hasEffectivePermission(
  role: UserSystemRole | undefined,
  userPermissions: readonly string[] | undefined,
  resource: string,
  action: AppAction,
): boolean
```

**Einzige Quelle der Match-Wahrheit** — ersetzt die vormals drei divergenten
Kopien (cloud `ruleMatches`, edge `checkRule`, frontend inline-`can()`).

Semantik (rein additiv):
1. `RolePermissions[role]` enthält eine passende `{ resource, action }`-Regel?
   (`MANAGE` deckt jede Aktion ab — exakt die alte Matrix-Semantik.) → erlaubt.
2. Sonst: enthält `userPermissions` einen `grant:`, dessen Ressource passt und
   dessen Aktion `MANAGE` **oder** die gefragte ist? → erlaubt.
3. Sonst → verweigert.

`roles.matrix.ts` bleibt **unverändert** — Grants sind orthogonal additiv.

## 3. Capability-Bundles

**Datei:** `libs/domains/users/domain/src/lib/capability-bundles.ts`

Fachlich benannte Pakete (`CapabilityBundles`), die auf konkrete Grants
expandieren. **Auf dem User-Doc landen die expandierten Grants** — die Hooks
bleiben „dumm", Bundles sind reine UI-/Seed-Sache.

| `id` | `group` | Grants |
|---|---|---|
| `wareneingang` | lager | `incoming-goods:manage`, `incoming-goods-extract:create`, `stock-levels:read`, `suppliers:read` |
| `inventur-bestand` | lager | `inventories:manage`, `inventory-movements:manage`, `write-offs:manage`, `stock-levels:read` |
| `katalog` | katalog | `products:manage`, `product-groups:manage`, `recipes:manage`, `ingredients:manage`, `pricelists:manage` |
| `zeit-auswertung` | personal | `working-times:update`, `working-time-reports:read`, `business-day-reports:read` |

`expandBundles(ids)` → deduplizierte Grant-Strings (unbekannte IDs ignoriert).

## 4. Grant-Assignment-Policy (Escalation-Guard, geteilt)

**Datei:** `libs/domains/users/domain/src/lib/grant-assignment-policy.ts` (seit 2026-07-03)

Framework-agnostischer Kern des Escalation-Guards beim **Vergeben** von Grants
(analog `self-patch-policy.ts`: strukturierte Violation statt Throw). Semantik
1:1 vom Cloud-Guard (`apps/api-cloud/src/hooks/restrict-permission-grants.hook.ts`)
übernommen:

```ts
extractAddedGrants(next, existing)        // Delta: nur NEUE grant:-Tokens (can_* ignoriert)
checkGrantAssignment(actor, addedGrants)  // → GrantAssignmentViolation | null
```

- **Decke:** effektive Rechte des Akteurs (`hasEffectivePermission` über Rolle +
  eigene Grants). Plattform-Akteure (`platform:*`) **oder** Impersonation
  (`actAs`) werden auf `TENANT_OWNER`-Niveau gedeckelt — nie die
  Plattform-Rechte des Operators.
- **Violations:** `MISSING_USER` / `INVALID_GRANT` (Format/unbekannte
  Ressource-Aktion) / `ESCALATION`. Adapter mappen `INVALID_GRANT` → 400
  BadRequest, sonst 403 Forbidden.
- **Delta-Semantik:** Entzug/Beibehalten bereits gesetzter Grants ist immer
  erlaubt — geprüft werden nur neu hinzukommende Tokens.

**Edge-Adapter:** `apps/api-edge/src/hooks/restrict-permission-grants.hook.ts` —
verdrahtet in `users.ts` auf `before.create` + `before.patch` (nach
`restrictUserSelfPatch`, vor `validateData` — analog Cloud). Interner Bypass
(`provider: undefined`, z. B. Sync-Apply) und Delta-Bildung via internem `get`
leben im Adapter. Wichtig: `PRIVILEGED_ROLES` (u. a. `TENANT_OWNER`) umgehen die
Self-Patch-Restriction — dieser Guard ist am Edge der einzige Schutz gegen
Grant-Selbst-Eskalation. Blockierte Vergaben loggen
`security.grant_escalation_blocked`.

Der Cloud-Guard nutzt die geteilte Policy noch nicht (lokale Kopie der
Semantik) — Umstellung braucht Core-Publish + Pin-Bump (Folgearbeit).

## 5. Verifikation

`effective-permissions.spec.ts` (15 Tests): Matrix × Grants, `MANAGE` ⇒ `READ`,
Unbekannt-Token-Reject, Grant-Parsing mit `/` in der Ressource.
`grant-assignment-policy.spec.ts` (13 Tests): Rollen-Decke, Plattform-/
Impersonation-Deckelung, Delta-/Filter-Semantik, INVALID_GRANT.
`restrict-permission-grants.hook.spec.ts` (api-edge, 6 Tests): interner Bypass,
Forbidden/BadRequest-Mapping, Delta gegen Bestandsdatensatz.

## 6. Edge-Status

**Erledigt (2026-07-06, Qualitäts-Review Stufe 3.2):** Der Edge-`authorize.hook`
nutzt jetzt `hasEffectivePermission` (Rolle ODER Grant), ein explizites
Custom-Method-Mapping (MANAGE-only-Fallback statt stillem READ) und hat die
`SYSTEM`-Wildcard verloren (Cloud-Semantik; kompensiert durch additive
Matrix-Einträge). Zeiterfassungs-Methoden akzeptieren alternativ die
`CAN_CLOCK_IN`-Ability via neuem Helper `hasEffectiveAbility`.
Details: [edge-authorize-hybrid-rbac.md](edge-authorize-hybrid-rbac.md).
Der Vergabe-Guard (§4) war am Edge bereits vorher scharf.
