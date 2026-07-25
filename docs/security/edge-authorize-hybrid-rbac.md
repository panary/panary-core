---
type: Architecture
title: Edge-authorize — Hybrid-RBAC (hasEffectivePermission) + explizites Method-Mapping
description: Edge-authorize()-Hook setzt Hybrid-RBAC via hasEffectivePermission durch — explizites Method-Mapping, MANAGE-only-Fallback und Wegfall der SYSTEM-Wildcard.
tags: [users, shared-backend, rbac]
status: stable
generated: { by: claude-code/historic, at: 2026-07-06T00:00:00Z }
---

# Edge-authorize auf Hybrid-RBAC (Stufe 3.2 des Qualitäts-Reviews)

## Problem

Der Edge-`authorize()`-Hook (`libs/shared/backend/src/hooks/authorize.hook.ts`,
konsumiert von `api-edge` per Service-Hook-Chain UND global via
`secureByDefault`) hatte drei Schwächen gegenüber dem Cloud-Pendant:

1. **Grants wirkungslos:** Es wurde ausschließlich die Rollen-Matrix geprüft
   (`checkRule`). Vergebene Pro-User-Grants (`grant:<resource>:<action>` im
   `user.permissions`-Array, siehe [Granulare Berechtigungen](granulare-berechtigungen-helper.md))
   wurden am Edge NICHT durchgesetzt — obwohl `permissions` bereits zum Edge
   synchronisiert wird.
2. **Stilles READ für unbekannte Custom-Methods:** Der `default`-Zweig des
   Method-Mappings fiel auf `AppAction.READ` zurück. `checkin`/`checkout`/
   `verifyPin`/`openAuthorized`/`preflight`/… liefen dadurch mit dem
   READ-Recht der jeweiligen Ressource durch — jede künftige mutierende
   Custom-Method wäre automatisch mit READ freigeschaltet gewesen.
3. **SYSTEM-Wildcard:** Eine Matrix-Regel `{ resource: SYSTEM, ... }` matchte
   JEDE Ressource. `TENANT_TECHNICIAN` (SYSTEM: MANAGE) kam damit am Edge
   überall durch — die Cloud kennt diese Wildcard nicht (Drift).

## Entscheidung

Der Edge-Hook nutzt jetzt dieselben Bausteine wie der Cloud-Hook:

- **`hasEffectivePermission(role, permissions, resource, action)`**
  (`@panary/users/domain`) — Rolle (Matrix) ODER additiver Grant, EINE Quelle
  der Wahrheit mit Cloud-Backend und Frontend-`can()`.
- **Explizites `METHOD_TO_ACTION`-Mapping** für alle Edge-Custom-Methods
  (`convert`, `openDay`/`closeDay`/`refreshClosingStatus`, `reEnqueue`,
  `verifyPin`→READ, `checkin`/`checkout`/`startBreak`/`endBreak`→UPDATE,
  `openAuthorized`→CREATE, `preflight`→READ, `startBootstrap`/`syncNow`→UPDATE).
- **MANAGE-only-Fallback:** Unbekannte Methoden mappen auf den Methodennamen
  als Action (Cloud-Semantik) — das matcht nur `MANAGE`-Regeln. Jede neue
  Custom-Method MUSS explizit gemappt werden, sonst 403 für Nicht-MANAGE-Rollen.
- **Kein SYSTEM-Wildcard mehr** (Cloud-Semantik von `roleRuleMatches`).
- **`normalizePermissions`:** SQLite speichert `permissions` als JSON-Text;
  defensives Parsen, falls ein Aufrufpfad das Feld un-geparst durchreicht.

### Zeiterfassungs-Sonderfall (CAN_CLOCK_IN)

`checkin`/`checkout`/`startBreak`/`endBreak` mutieren User + working-times →
fachlich UPDATE (wie im Cloud-Mapping). `DEVICE_POS`/`DEVICE_TABLET` stempeln
Mitarbeiter aber über das Geräte-JWT und haben bewusst KEIN `users:UPDATE`
(das würde beliebige User-Patches erlauben). Für genau diese vier Methoden auf
der `users`-Ressource genügt daher alternativ die fachliche
**`CAN_CLOCK_IN`-Ability** — geprüft über den neuen Helper
`hasEffectiveAbility(role, permissions, ability)` (`@panary/users/domain`):
Ability-String in der Rollen-Matrix ODER im `user.permissions`-Array.

### Additive Matrix-Kompensation (Wildcard-Wegfall)

Ressourcen, die `TENANT_TECHNICIAN` vorher nur über die SYSTEM-Wildcard
erreichte, sind jetzt explizit eingetragen (rein additiv, Cloud-kompatibel):

| Rolle | Neu | Grund |
|---|---|---|
| `TENANT_TECHNICIAN` | `log-export: READ` | Log-Export-Diagnose (Owner/Manager hatten es bereits) |
| `TENANT_TECHNICIAN` | `organizations: READ` | Organisations-/Location-Auswahl beim Device-Pairing |
| `TENANT_TECHNICIAN` | `fiscal-counters: READ` | Fiskal-Zähler-Prüfung (neue `AppResource.FISCAL_COUNTERS`) |
| `TENANT_OWNER` | `fiscal-counters: READ` | Parität: Owner darf eigene Fiskal-Daten prüfen (Receipts liest er ohnehin) |

`fiscal-counters` wird weiterhin ausschließlich intern geschrieben
(issue-receipt-Hook, `provider: undefined` → authorize-Bypass).

## Konsequenzen

- **Grants gelten jetzt auch am Edge:** z. B. `TENANT_STAFF` +
  `grant:incoming-goods:manage` kommt durch; ohne Grant → 403. Verhalten ist
  identisch zur Cloud (gleicher Helper).
- **Bewusste Tightenings** (kein Flow betroffen, aber Verhaltensänderung):
  - `TENANT_TECHNICIAN` kann extern keine `receipts` mehr anlegen/löschen
    (vorher via Wildcard möglich; jetzt READ+UPDATE wie in der Matrix
    dokumentiert — Belege sind append-only).
  - `PLATFORM_ADMIN`/`PLATFORM_SUPPORT` verlieren die Edge-Wildcard —
    Plattform-Identitäten existieren am Edge ohnehin nicht (kein Sync von
    Memberships mit `tenantId: null`); `PLATFORM_OWNER`-Bypass bleibt.
  - Zeiterfassung via `PLATFORM_ADMIN`/`PLATFORM_SUPPORT` (users:READ) ist
    nicht mehr möglich — war nie ein Produkt-Flow.
- **Tote Mappings entfernt:** `startClosing`/`cancelClosing`/`reAggregate`/
  `exportDsfinvk`/`printZBon` sind KEINE Edge-Methoden (Cloud-only am
  `business-day-reports`- bzw. `receipts-export`-Service; die Cloud nutzt
  ihren eigenen Hook). Falls sie je am Edge landen, greift der
  MANAGE-only-Fallback bis zum expliziten Mapping.
- **Cloud-Folgearbeit:** `hasEffectiveAbility` ist neue Core-API — für die
  Cloud erst nach dem nächsten Core-Release/Pin-Bump nutzbar (Option A).
  Der Cloud-Hook mappt `checkin` etc. heute hart auf UPDATE ohne
  Ability-Alternative; falls POS-Geräte im Cloud-Direct-Modus stempeln
  sollen, denselben Sonderfall dort nachziehen.

## Tests

- `libs/shared/backend/src/hooks/authorize.hook.spec.ts` (65 Tests gesamt in
  shared-backend): Bypässe, Matrix-/Grant-Fälle, JSON-String-Permissions,
  MANAGE-only-Fallback, Wildcard-Wegfall, CAN_CLOCK_IN-Sonderfall (inkl.
  Scoping auf users-Ressource), komplette Custom-Method-Tabelle (Rolle × Methode).
- `libs/domains/users/domain/src/lib/effective-permissions.spec.ts`:
  `hasEffectiveAbility` (Matrix-Ability, permissions-Ability, Negativfälle).
- `apps/api-edge`-Integrationstests (197 Tests) decken die echten Flows
  (verifyPin, sync-outbox, Bootstrap) unverändert grün ab.
