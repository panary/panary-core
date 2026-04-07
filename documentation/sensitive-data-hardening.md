---
title: Sicherheitshärtung — Sensible Daten in der Datenbank
date: 2026-04-07
category: security
domains: [users, apikeys, cloud-connection, customers, corporate-customers]
status: aktiv
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

- **Cloud-Token AES-Encryption** bei Cloud-Sync-Implementierung
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
| `cloud-connection.cloudToken` | Klartext (Phase 2) |
| `corporate-customers.vatId/taxNumber` | Klartext (Phase 2) |
| `customers.email/phone` | Klartext (Phase 2) |
