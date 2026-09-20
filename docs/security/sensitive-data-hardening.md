---
type: Architecture
title: Sicherheitshärtung — Sensible Daten in der Datenbank
description: 'Härtung sensibler Datenbankfelder in Phase 1: POS-PIN als bcrypt-Hash mit serverseitigem verifyPin, API-Keys als SHA-256-Hash mit Show-Once-Prinzip; Phasen 2 und 3 offen.'
tags: [security, users, apikeys, cloud-connection, customers, corporate-customers]
status: stable
generated: { by: claude-code/historic, at: 2026-04-07T00:00:00Z }
updated: { by: claude-code/opus-5, at: 2026-09-20T08:20:00Z }
---

# Sicherheitshärtung: Sensible Daten (Phase 1)

## Problem

Mehrere sensible Felder wurden im Klartext in SQLite gespeichert. Vor der geplanten Cloud-Synchronisation mussten kritische Credentials gehärtet werden.

## Durchgeführte Änderungen (Phase 1 — Kritisch)

### POS-PIN: Bcrypt-Hash + serverseitige Validierung

**Vorher:** `posPin` als Klartext gespeichert, im Frontend verglichen.
**Nachher:** Bcrypt-Hash (Cost Factor 6), serverseitige Verifizierung via `verifyPin`.

- `users.schema.ts` — posPin wird in Create- und Patch-Resolver gehasht, im externalResolver entfernt
- `users.ts` — neue Custom-Methode `verifyPin(data: { userId, pin })` → bcrypt.compare
- `users.class.ts` — `verifyPin` im Service-Interface
- `login.component.ts` — Clientseitiger Vergleich durch Aufruf von `verifyPin` ersetzt
- Migration `20260407000001_hash_pos_pins.ts` — Bestehende Klartext-PINs hashen

### API-Key: Show-Once-Then-Hash

**Vorher:** `apikey` als Klartext-UUID gespeichert, direkt in DB-Queries gesucht.
**Nachher:** SHA-256-Hash gespeichert, Klartext nur einmalig bei Erstellung sichtbar.

- `apikey.schema.ts` — `apikeyPrefix` Feld (8 Zeichen) hinzugefügt
- `apikeys.schema.ts` — Create-Resolver: SHA-256-Hash + Prefix, Raw-Key via `context.params._rawApiKey`
- `channels.ts` — Geräte-Auth-Lookup: Prefix-Query + Timing-Safe Hash-Vergleich
- Migration `20260407000002_hash_api_keys.ts` — Bestehende Keys hashen, Prefix befüllen

### Neue Utility

- `apps/api-edge/src/utils/crypto.utils.ts` — `sha256()`, `timingSafeCompare()`

## Offene Punkte (Phase 2 & 3)

- ~~**Cloud-Token AES-Encryption** bei Cloud-Sync-Implementierung~~ — ✅ erledigt (siehe unten)
- **vatId/taxNumber** AES-Encryption vor Cloud-Übertragung (DSGVO)
- **resolveExternal** für Kunden- und Firmenkunden-PII
- **Rate-Limiting** auf `verifyPin` gegen Brute-Force
- **SENSITIVE_FIELDS** in canonical-log.hook.ts erweitern

## Sicherheitsklassifizierung (Gesamt)

| Feld | Status nach Phase 1 |
|---|---|
| `users.password` | Bcrypt-Hash (unverändert) |
| `users.posPin` | **Bcrypt-Hash** (NEU) |
| `apikeys.apikey` | **SHA-256-Hash** (NEU) |
| `cloud-connection.cloudToken` | **AES-256-GCM** at-rest (Nachtrag 2026-05-10) — siehe Hinweis unten |
| `corporate-customers.vatId/taxNumber` | Klartext (Phase 2) |
| `customers.email/phone` | Klartext (Phase 2) |

> 🚨 **Nachtrag 2026-09-20: Die Zeile zu `cloudToken` stand über vier Monate falsch hier.**
> `apps/api-edge/src/utils/cloud-token-cipher.ts` verschlüsselt den Token seit dem
> 2026-05-10 mit **AES-256-GCM** at-rest (Format `enc:v1:<iv>:<ciphertext>:<tag>`); alle
> Cloud-Worker lesen ihn über `decryptCloudToken`. Klartext-Bestand wird beim Lesen am
> fehlenden `enc:`-Prefix erkannt und durchgereicht, damit die Migration ohne Force-Re-Pair
> läuft — die Token verschlüsseln sich beim nächsten Rotationszyklus selbst nach.
>
> ⚠️ **Mit einer Bedingung, die zur Aussage gehört:** Der Master-Key kommt aus
> `EDGE_TOKEN_ENCRYPTION_KEY`. **Fehlt er, ist der Cipher ein No-op** — er loggt eine Warnung
> und speichert weiter Klartext, damit Dev-Setups nicht hart brechen. „Verschlüsselt" gilt
> also genau für Installationen, in denen diese Variable gesetzt ist; ob sie es auf einem
> konkreten Edge ist, beweist dieses Dokument nicht.
