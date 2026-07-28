---
type: Domain Concept
title: 'Tenant-Edge-Replica — projizierte Tenant-Stammdaten am Edge'
description: 'Read-only tenants-Service am Edge speichert die Cloud-projizierte Tenant-Sicht (Receipt-Branding, Logo, Localization, Rechtsperson, TSE-Referenzen) via Pull-Sync — der Edge schreibt niemals zurück.'
tags: [tenants, sync, edge, tse, receipts]
status: stable
generated: { by: claude-code/fable-5, at: 2026-07-28T00:00:00Z }
---

# Tenant-Edge-Replica

Abschluss von **OoS-Welle E Item 4**: Das Tenant-Doc wird als Master-Data
Cloud→Edge gesynct. Die Cloud war fertig (Pull-Strategie + Allowlist-Projection
`projectTenantForEdge` in panary-cloud), am Edge fehlte aber der `tenants`-Service —
jeder Pull-Zyklus lief mit `Can not find service 'tenants'` ins Leere
(Befund Testkunde Köttersfritte, 2026-07-28).

## Was der Edge bekommt (Allowlist-Projection)

Die Cloud liefert NIE das volle Tenant-Doc, sondern die kuratierte Sicht aus
`apps/api-cloud/src/services/sync/projections/tenant-projection.ts` (panary-cloud):

| Block | Inhalt | Konsument (geplant/vorhanden) |
|---|---|---|
| `name`, `status`, `region` | Kern-Stammdaten | Bon-Kopf, Diagnostik |
| `branding` | `receiptHeader`/`receiptFooter`, `primaryColor`, `logo` (base64-BinData) | Offline-Bon-Druck mit Logo (OoS-Item-7) |
| `localization` | `locale`, `timezone`, `weekStart`, `currency` | Receipt-Renderer |
| `legalEntity` | `registeredName`, `legalForm`, `vatId`, `countryCode` | Beleg-Footer (Pflichtangaben) |
| `tse` | NUR Referenzen/IDs (`provider`, `apiKeyRef`/`apiSecretRef` = BWS-Secret-IDs) | per-Tenant-Provider-Auswahl via `tseProviderFromTenant` |

Cloud-only bleiben: Subscription, Billing/Stripe, SecurityPolicy, Compliance,
internalNotes, TSE-Kontaktdaten/Health. Diese Felder dürfen **niemals** in das
Edge-Schema aufgenommen werden.

## Bausteine (dieses Repo)

| Baustein | Pfad |
|---|---|
| Edge-Schema (TypeBox, exakt die Projektion) | `libs/domains/tenants/domain/src/lib/edge-tenant.schema.ts` |
| Edge-Service (read-only Replica) | `apps/api-edge/src/services/tenants/` |
| SQLite-Tabelle `tenants` + Cursor-Reset | `apps/api-edge/migrations/20260728190000_tenants.ts` |
| Bootstrap-Pull (`PULL_ONLY_MASTER_SERVICES`) | `apps/api-edge/src/workers/cloud-bootstrap-runner.worker.ts` |
| Delta-Pull (Allowlist-Iteration) | `apps/api-edge/src/workers/cloud-sync-scheduler.worker.ts` |

## Architektur-Regeln

- **Kein `tenantId`-Feld:** Das `_id` der Replica IST der Tenant-Identifier.
  Statt `multiTenancy()` scoped der Service-Hook `scopeToOwnTenant` externe
  Zugriffe hart auf `_id = user.tenantId` (platform:*-Bypass wie gewohnt).
- **Read-only am Edge:** `cloudManaged()` blockt externe Writes nach Pairing;
  einzige Schreibquelle ist der Pull-Apply (`provider: undefined, fromSync: true`).
  `tenants` steht bewusst NICHT in `SyncableTransactionService` und wird vom
  `sync-outbox-recorder` nie zurückgepusht.
- **Bootstrap:** `tenants` ist Cloud-Master-only (`PULL_ONLY_MASTER_SERVICES`) —
  nur im Cloud→Edge-Pull enthalten (upsert, ohne Truncate), niemals im
  Edge→Cloud-Push oder Merge-by-external-id. In den Modi ohne Bootstrap-Pull
  holt der erste reguläre Sync-Zyklus den Tenant (leerer Cursor ⇒ Voll-Pull).
- **Enum-Toleranz:** Das Edge-Schema koppelt `status`/`weekStart`/`tse.provider`
  bewusst NICHT an Cloud-Enums — ein neuer Enum-Wert in der Cloud darf den
  Pull-Apply nicht terminal ablehnen (Fehlerklasse des locations-Befunds
  v26.7.35). Deploy-Reihenfolge bei neuen Projektions-Feldern: erst Edge-Schema,
  dann Cloud-Projection.
- **TSE-Refs nicht extern:** `resolveExternal` blendet das `tse`-Objekt für
  externe Clients aus — die BWS-Secret-IDs braucht nur die Edge-interne
  TSE-Factory.

## Abgrenzung: `organizations`-Service

Der Edge-`organizations`-Service (Setup-Wizard) leitet Tenants weiterhin aus der
`locations`-Tabelle ab und bleibt unberührt — er dient der Tenant-*Auswahl* vor
dem Pairing, die Replica den Tenant-*Stammdaten* nach dem Pairing.

Verwandt: [Rabatte (Edge-Sync-Muster)](rabatte.md),
[Sync-Apply Shared-Modul](../architecture/sync-apply-shared-modul.md).
