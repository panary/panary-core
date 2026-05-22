---
title: E-Mail-Identität — Edge- & Shared-Schema-Impact
date: 2026-05-22
category: Sicherheit
domains: [users, auth, sync]
status: implemented
---

# E-Mail-Identität — Edge- & Shared-Schema-Impact

Die Plattform stellt den Login von `loginname` auf **E-Mail** um und führt in der Cloud eine
globale `accounts`-Collection + Multi-Tenant-Mitgliedschaft ein. Der vollständige ADR (Motivation,
Cloud-Architektur, Sicherheits-Gates, Vorher/Nachher) liegt in
`panary-cloud/documentation/email-identity-multi-tenant-membership-adr.md`. Dieses Dokument hält
den **Impact auf panary-core (Edge + geteiltes Schema)** fest.

## Geteiltes Schema (`@panary/users/domain`)

- `loginname` → **optional** (nur noch Anzeige-/Audit-Handle, kein Login-Identifier, keine Uniqueness).
- `password` → **optional** (Cloud-Membership hat keins; das flache Edge-User-Doc bekommt den
  bcrypt-Hash per Sync-Projektion — **nicht entfernen**, sonst bricht die Edge-Validierung).
- Neues optionales Feld `accountId` (Membership→globale Identität). Am Edge **ignoriert**, muss aber
  im Schema deklariert sein (`additionalProperties: false`).
- Neue geteilte Pure-Function `generateLoginname()` / `ensureUniqueLoginname()` — von Edge und Cloud
  im Create-Resolver genutzt (Umlaut-Transliteration, Fallback-Kaskade, im Sync-Pfad unverändert
  durchgereicht).

## Edge (single-tenant, flach)

- Der Edge bleibt **single-tenant**: ein User-Doc trägt `email`+`password` direkt; **keine**
  `accounts`-Tabelle. `config/default.json` → `local.usernameField: "email"`.
- Bootstrap-Admin (`main.ts`): Existenz-Check per `email` statt `loginname` (`ADMIN_EMAIL` ist
  ohnehin Pflicht-Voraussetzung).
- Admin-Client-Login: E-Mail-Feld.
- Audit-Handle: `apikeys.createdBy` stempelt `params.user._id` statt `loginname`.

## Sync (Cloud→Edge)

Cloud-seitig joint `projectUserForEdge` das `account`-Doc und mergt via Allowlist `email` +
`password`-Hash in das flache Edge-Doc; `accountId`/MFA bleiben Cloud-only (Gate K4). Edge-Push mit
gesetztem `accountId` wird abgelehnt (Gate K3). POS-Personal (PIN) bleibt tenant-lokal,
`accountId=null`.

## Offen

- Account-globaler Passkey (H1) und MFA-after-mint (H4) — Cloud-Follow-up.
