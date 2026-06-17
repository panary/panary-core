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
Cloud-Backend (`authorize.hook`, `restrict-permission-grants.hook`) und
Cloud-Frontend (`auth.service.can()`); Edge-Adoption ist P2.

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

## 4. Verifikation

`effective-permissions.spec.ts` (15 Tests): Matrix × Grants, `MANAGE` ⇒ `READ`,
Unbekannt-Token-Reject, Grant-Parsing mit `/` in der Ressource.

## 5. Edge-Status (P2)

`permissions` synchronisiert bereits zum Edge (`USER_JSON_FIELDS`). Die Adoption
des Helpers im Edge-`authorize.hook` (inkl. `SYSTEM`-Wildcard-Abgleich +
POS-PIN-Implikationen) steht noch aus — eigener Risiko-Check, da die Edge-Variante
ein abweichendes `SYSTEM`-Wildcard hat.
