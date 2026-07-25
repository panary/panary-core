---
type: Report
title: 'Security- & Logik-Review Juli 2026 — Befunde, Fixes & Release-Koordination'
description: 'Konsolidierung des parallelen 4-Reviewer-Security- und Logik-Reviews über Core und Cloud: 33 Rohbefunde, Fixes in den Releases 26.7.16 und 26.7.22, begründete Wont-fixes.'
tags: [security, orders, sync, devices, apikeys, platform-tenants]
status: stable
generated: { by: claude-code/historic, at: 2026-07-04T00:00:00Z }
---

# Security- & Logik-Review Juli 2026

Konsolidierte Dokumentation des parallelen 4-Reviewer-Security- & Logik-Reviews über
`panary-core/` und `panary-cloud/` (Scope: `apps/` + `libs/domains/`; Legacy `panary/` und
`smartfoodorders-server/` explizit ausgeschlossen). 33 Rohbefunde, dedupliziert und
adversarial gegen den Code verifiziert. **Ergebnis: kein bestätigtes offenes Sicherheitsloch.**
Alle bestätigten Critical/High-Befunde sind gefixt; der Rest ist bewusste Härtung oder
begründet als Wont-fix eingestuft.

Laufende Nachverfolgung (Kurzfassung) im Memory `project-security-review-2026-07`.

---

## 1. Gefixt & live in Prod (Release 26.7.16)

| ID | Befund | Fix | Pfad |
|---|---|---|---|
| A1 | Print-Server-API-Key im Klartext verglichen (Auth war zusätzlich fail-closed → Druck via `X-Api-Key` tot) | SHA-256-Hash-Lookup über `apikeyPrefix` + `timingSafeCompare` (spiegelt `channels.ts`) | `panary-core/apps/api-edge/src/print-server/auth.middleware.ts` |
| A3 | `Type.Any()` auf `order.transaction.data` + `customer.invoices` (bricht Konsumenten-Typsicherheit, keine Constraints) | → `Type.Unknown()` (nicht-brechend, via `nx affected build` verifiziert) | `libs/domains/orders/domain/src/lib/order.schema.ts`, `.../customers/domain/src/lib/customer.schema.ts` |
| A4 | Sync-Date-Coercion doppelt definiert (Drift-Risiko) | `CLOUD_EDGE_DATE_FIELDS` als Single Source | `panary-cloud/apps/api-cloud/src/services/cloud-edges/cloud-edges.ts` → `sync/sync.ts` |
| B2 | Tenant-Bootstrap-Rollback schluckte Fehler (`.catch(()=>undefined)` × 12) | `logRollbackFailure`-Helper — Rollback-Fehler werden geloggt | `panary-cloud/apps/api-cloud/src/services/platform-tenants/platform-tenants.ts` |
| #1 | Storno-Reversal ohne `stockMovementIds` blieb unbemerkt | Warn-Log-Event `orders.stock_reverse_no_movement_ids` + Test | `panary-cloud/apps/api-cloud/src/hooks/order-stock-update.hook.ts` |

---

## 2. Gefixt in dieser Iteration (Release 26.7.22)

Diese Fixes sind committed und werden **gemeinsam** in Release 26.7.22 ausgerollt
(Core-Lib-Publish → Cloud-Pin-Bump → Cloud-Prod-Deploy, siehe §4).

| Befund | Fix | Pfad(e) |
|---|---|---|
| **order-status-fsm** (High) — illegale Status-Rücksprünge aus Terminal-Zuständen | Übergangs-Guard `assertValidOrderStatusTransition` (Pure Function in `@panary/orders/domain`, wirft Error → im Frontend-Bundle kein `@feathersjs/errors`); Edge- + Cloud-Hook prüfen den Übergang vor Patch | `libs/domains/orders/domain/src/lib/order-state-machine.ts`; `apps/api-edge/.../validate-order-status-transition.hook.ts`; `panary-cloud/apps/api-cloud/.../validate-order-status-transition.hook.ts` |
| **discount-mutex** (Med) — Legacy-`order.discount` + neues `appliedDiscounts[]` gleichzeitig gesetzt (Doppel-Rabatt-Risiko) | `clearLegacyDiscountIfApplied`: bei nicht-leerem `appliedDiscounts` wird Legacy-`discount` server-seitig auf `null` geleert (Edge+Cloud, create+patch); Edge-SQLite-Serialisierung von `appliedDiscounts`/`stockMovementIds` nachgezogen | `libs/domains/orders/domain/src/lib/pricing/discount-mutex.ts`; Edge+Cloud `orders.schema.ts`/`orders.ts` |
| **stockmovement-null** (Med) — Storno ohne `stockMovementIds` hinterließ stille Bestands-Inkonsistenz | Intern gesetztes `stockAnomalyDetectedAt`-Flag am Order (dauerhafte Markierung); Resolver lässt nur `provider===undefined \|\| fromSync` durch (siehe Memory `feedback-protect-from-external-strips-internal`) | `libs/domains/orders/domain/src/lib/order.schema.ts`; `panary-cloud/apps/api-cloud/src/hooks/order-stock-update.hook.ts` |
| **classify-forbidden** — permanente Forbidden (`TENANT_SUSPENDED`) wurde als retrybar klassifiziert (Endlos-Retry) | Neben `backfill/24h` wird jetzt auch `tenant_suspended` als TERMINAL klassifiziert | `panary-cloud/apps/api-cloud/src/services/sync/classify-accept-error.ts` |
| **B5 device-stamp** — `lastSeen`-Patch ohne expliziten Tenant-Scope | Expliziter `tenantId`-Scope im `stampDeviceLastSeen`-Query (connect + disconnect) | `panary-cloud/apps/api-cloud/src/channels.ts` |

**⚠️ Befund order-status-fsm — COMPLETED ist NICHT hart terminal:** Die ursprüngliche
Reviewer-Annahme „alle Übergänge aus COMPLETED blocken" war zu grob. Legitim sind
`COMPLETED → UNCLAIMED` (TTL-Reclaim) und `COMPLETED → ABORTED` (Storno/Refund). Der Guard
erlaubt diese bewusst; nur echte illegale Rücksprünge werfen. Details: Memory
`project-order-status-fsm-guard`.

---

## 3. Wont-fix (begründet)

Mehrere von automatisierten Verifier-Agenten vorgeschlagene „Fixes" waren **schädlich** und
hätten legitime Funktionen gebrochen. **Lehre: Verifier-Fixvorschläge immer adversarial gegen
den aktuellen Code prüfen.**

| Befund | Warum kein Fix |
|---|---|
| B3 `apikeyPrefix` aus Query-Properties entfernen | **Würde die A1-Print-Server-Auth brechen** — sie nutzt `apikeyPrefix` als Query-Property über die Service-API (`validateQuery` läuft immer). |
| userpatch-resolver: `role`/`permissions` in Resolver schützen | **Würde die Admin-Rollenverwaltung brechen** — der Resolver kann Self- vs. Admin-Patch nicht unterscheiden; der `restrict-user-self-patch`-Hook schützt Self-Patches bereits korrekt (`permissions` NIE in `SELF_PATCHABLE_FIELDS`). |
| discount-clamp | Klemmen (Rabatt ≤ Bestellwert) ist korrektes Verhalten; `valuePercent` ist schema-validiert 0–100. |
| B4 Login-Timing-Oracle | Dummy-Hash + Rate-Limit sind bereits robust. |
| B1 Promo raw `findOneAndUpdate` | Bewusste TOCTOU-Ausnahme (platform-global, kein Tenant-Scope betroffen). |
| mainprice-constraint | Hartes Required-Constraint = Breaking Change; Fallback ist bewusst. |
| platform-agg-hygiene | Großes Refactoring ohne Sicherheitsgewinn (platform-only ist bewusst all-tenants). |

**Vom parallelen Agenten separat gelöst:** `fromsync-resolver` (`protectFromExternal`-Helper),
`syncpull-projection` (deklarative Projektions-Registry).

---

## 4. Release-Koordination (26.7.22)

Der Cloud-FSM-Fix importiert `assertValidOrderStatusTransition` aus `@panary/orders/domain` —
eine **neu** in Core hinzugefügte Funktion. Der Cloud-Prod-Build (`--frozen-lockfile` gegen die
Registry) findet sie erst, wenn Core sie publiziert **und** der Cloud-Pin darauf zeigt. Daher
ist die Reihenfolge **zwingend**:

1. **Core-Lib-Release 26.7.22** — publishable Libs manuell vorwärts bumpen (`nx release version
   26.7.22`; **nicht** `pnpm release`, das rechnet die Lib-Version rückwärts auf 26.7.16 und
   kollidiert beim Publish, siehe Memory `project-edge-version-flows-drift`), Tag `v26.7.22`
   push → `publish-libraries.yml` publiziert `@panary/*@26.7.22` + `build-edge-docker.yml` baut
   das Edge-Image.
2. **Cloud-Pin-Bump** — `@panary/*`-Ranges auf `^26.7.22` + `tools/scripts/update-lockfile.sh`
   (ein Commit).
3. **Cloud-Release** — `release-tag.sh --push` (Auto-Index) → `build-and-push.yml` deployt Prod
   via Coolify.

**UI-Versionierung + Reload:** panary-cloud meldet seit Commit `c1bc4965` die `API_VERSION`
über `/health`; die geladene UI erkennt eine Versions-Drift und zeigt einen Update-Hinweis
(`version-monitor.service.ts` + `update-banner.component.ts`). Ein Cloud-Versionsbump löst damit
für aktive Nutzer den Reload-Hinweis aus — beabsichtigt. Details:
`panary-cloud/docs/infrastructure/versions-konsistenz-und-update-hinweis.md`.

---

## 5. Verwandte Dokumentation

- `panary-core/docs/domains/rabatte.md` — discount-mutex im Kontext des Rabatt-Datenmodells
- `panary-core/docs/adr/0003-schema-feld-haertung.md` — A3 (`Type.Any()` → `Type.Unknown()`)
- `panary-core/docs/adr/0002-library-publishing.md` — `@panary/*`-Publish-Ablauf (§4)
- `panary-cloud/docs/infrastructure/versions-konsistenz-und-update-hinweis.md` — UI-Reload bei Versionsbump
