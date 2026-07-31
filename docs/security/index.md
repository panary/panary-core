# Sicherheit

Sicherheitskonzepte, RBAC, Härtungen und Security-Reviews (`type: Architecture` oder `Report`).

* [E-Mail-Identität — Edge- & Shared-Schema-Impact](email-identity-edge-impact.md) - Auswirkungen der E-Mail-Login-Umstellung auf Edge und geteiltes Users-Schema: optionale loginname/password-Felder, accountId und Cloud-zu-Edge-Sync-Projektion.
* [Edge-authorize — Hybrid-RBAC (hasEffectivePermission) + explizites Method-Mapping](edge-authorize-hybrid-rbac.md) - Edge-authorize()-Hook setzt Hybrid-RBAC via hasEffectivePermission durch — explizites Method-Mapping, MANAGE-only-Fallback und Wegfall der SYSTEM-Wildcard.
* [Effektive Berechtigungen — hasEffectivePermission + Capability-Bundles](granulare-berechtigungen-helper.md) - Geteilte RBAC-Bausteine in @panary/users/domain mit hasEffectivePermission als einziger Match-Wahrheit, grant-Format und Capability-Bundles für additive Pro-User-Berechtigungen.
* [POS-PIN — erzwungener Wechsel bei der nächsten Anmeldung (mustChangePosPin)](pos-pin-erzwungener-wechsel.md) - Vom Admin vergebene POS-PINs erzwingen über das Flag mustChangePosPin einen Wechsel beim nächsten Terminal-Login, umgesetzt über die neue Custom-Method users.changePin mit Proof-of-Possession.
* [Security- & Logik-Review Juli 2026 — Befunde, Fixes & Release-Koordination](security-review-2026-07.md) - Konsolidierung des parallelen 4-Reviewer-Security- und Logik-Reviews über Core und Cloud: 33 Rohbefunde, Fixes in den Releases 26.7.16 und 26.7.22, begründete Wont-fixes.
* [Geräte-Credential-Lifecycle — API-Key-Kaskade und Nutzungs-Telemetrie](geraete-credential-lifecycle.md) - Beim Löschen eines Geräts wird sein API-Schlüssel serverseitig mitwiderrufen, und apikeys.lastUsedAt wird an beiden Auth-Pfaden gedrosselt gestempelt.
* [Sicherheitshärtung — Sensible Daten in der Datenbank](sensitive-data-hardening.md) - Härtung sensibler Datenbankfelder in Phase 1: POS-PIN als bcrypt-Hash mit serverseitigem verifyPin, API-Keys als SHA-256-Hash mit Show-Once-Prinzip; Phasen 2 und 3 offen.
* [Tenant-Audit-Events (Edge)](audit-events.md) - Append-only Tenant-Audit-Trail am Edge im Sidecar-Pattern mit TypeBox-Datenmodell, Resource-Whitelist und Spiegelung in die Cloud via Sync-Outbox.
