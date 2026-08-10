---
type: Plan
title: 'Filial-Hub (Edge-Server) — Anforderungen und offene Liefermodell-Entscheidung'
description: Anforderungen an einen Filial-Hub, der mehrere POS-Geräte einer Filiale offline-fähig bündelt, samt der offenen Entscheidung über das Liefermodell.
tags: [sync, devices, businessdays, tse]
status: draft
generated: { by: claude-code/opus-5, at: 2026-05-29T00:00:00.000Z }
verified: { by: human:michael, at: 2026-05-29T00:00:00.000Z }
stale_after: 2026-11-29
---

> **Herkunft.** Entstanden am 2026-05-29 außerhalb der Repos
> (`_WORKBENCH_PANARY/_planning/`) und dort bewusst nicht versioniert. Am 2026-08-08 ins
> Wiki übernommen, weil der Workbench-Root ein eigenes Repo bekam und Planungsartefakte
> dort nicht hingehören (`.claude/rules/documentation.md` §0).
>
> **Stand geprüft:** Es gibt am 2026-08-08 **keine Umsetzungsspur** im Code
> (`grep -li "filial-hub|edge-hub|edgeHub"` über `apps/` und `libs/` → 0 Treffer). Der Plan
> ist offen, nicht überholt. Inhaltlich ist er ein Schnappschuss vom Mai und **nicht** gegen
> den heutigen Code gegengelesen.

# Filial-Hub (Edge-Server) — Anforderungen

> **Ablage:** Liegt bewusst **außerhalb der Git-Repos** (`_WORKBENCH_PANARY/_planning/`),
> wird nicht eingecheckt. Querverweise auf `*.md` ohne Pfad meinen
> `panary-core/documentation/`.

## Kontext / woraus das entsteht

Aus der Mobile-POS-Recherche ([`mobile-pos-strategie-recherche.md`](mobile-pos-strategie-recherche.md))
ergab sich: Der Edge wird **kein Pflicht-Baustein mehr**, sondern ein **getiertes
Capability-Upgrade**:

- **Connect-Tier (cloud-direkt + schlanker Client-Offline-Cache):** kein Edge nötig.
  Einzel-Gerät, Online-TSE (Fiskaly), bei Ausfall → Bargeld + dokumentierter
  TSE-Ausfallmodus + Order-Replay. Kartenzahlung & Online-TSE-Signatur sind offline
  ohnehin nicht möglich (siehe Recherche §„Offline").
- **Operate-Tier (`offlinePos`):** **Edge = Filial-Hub.** Lohnt sich, sobald es
  mehrere Geräte, lückenlose Fiskal-Anforderungen, einen physischen Print-Server
  oder echtes Offline-Signieren (lokale TSE) gibt.

Dieses Dokument definiert die **Anforderungen an den Filial-Hub** und rahmt die noch
**offene Vertriebs-/Liefermodell-Entscheidung** (BYO-PC vs. Managed Appliance vs.
Whitelist) für die separate Recherche/Planung.

---

## 1. Was der Hub ist

Ein **headless, dauerhaft laufendes Gerät pro Filiale**, das die `api-edge`
(FeathersJS v5 + SQLite) hostet und für alle Geräte der Filiale der lokale
Source-of-Truth- und Koordinationsknoten ist. **Kein Kunden-PC zum Mitbenutzen** —
Appliance-Charakter.

### Funktionale Rollen (begründen die HW-Anforderungen)

- LAN-Endpunkt (HTTP + WebSocket, Port 3030) für N Satelliten: POS, KDS, Tablets
- Lückenlose Nummern-Autorität pro Location (`dailySequenceNumber`, Z-Bon-Nummer)
- Lokale Aggregation / Tagesabschluss (`@panary/businessdays/aggregator`)
- Druck-Koordination (MQTT-Broker + Print-Server, vgl. `print-server-api.md`)
- Einziges Sync-Gateway zur Cloud (Outbox / Cursor / Heartbeat)
- *Optional:* lokale/Hardware-TSE für echtes Offline-Signieren (entkoppelt von „offline
  Orders", siehe `fiskalisierung-architektur-adr.md`)

---

## 2. Hardware-Mindestanforderungen

| Dimension | Anforderung | Begründung |
|---|---|---|
| CPU | x86-64 **oder** ARM64, ≥ 2 Kerne | **ABI muss zum Build passen** — `better-sqlite3` ist nativ (glibc/bookworm); ARM-Build separat verifizieren |
| RAM | 2–4 GB | Node + SQLite-WAL + MQTT-Broker |
| Storage | SSD/eMMC ≥ 32 GB, möglichst Power-Loss-Schutz | DB + append-only Audit-Trail wachsen; Integrität bei Stromausfall |
| Netzwerk | **Ethernet bevorzugt**, WLAN-Fallback | stabiles LAN ist betriebskritisch für Satelliten-Sync |
| Bauform | lüfterlos, gastro-tauglich (Staub/Hitze), 24/7-Dauerbetrieb, headless | Theken-/Küchenumgebung, kein Display nötig |
| Strom | sauberes Shutdown-Verhalten, USV-Empfehlung | SQLite-Integrität (WAL) bei Stromausfall |

---

## 3. Software / Runtime

- Node 22 (glibc) — bereits containerisiert (`node:22-bookworm-slim`)
- Container-Runtime (Docker/Podman) **oder** gehärteter Bare-Metal-Service
- SQLite (better-sqlite3, nativ), MQTT-Broker, Auto-Update-Agent
- Secrets über das vorhandene **BWS-Pattern** (Bitwarden Secrets) — kein Klartext auf dem Gerät

---

## 4. Betrieb & Lifecycle (operativer Kern — größter Schmerzpunkt)

- **Zero-Touch-Provisioning:** einstecken → QR-Pairing gegen Cloud, keine Vor-Ort-Konfiguration.
  *(Cloud-Pairing-Wizard existiert bereits — `cloud-pairing-wizard.md`.)*
- **Remote-Monitoring / Flottensicht:** Heartbeat, `/health`, `device-connections` sind
  vorhanden → zentrale Übersicht aller Hubs in der Cloud.
- **Kontrollierte Remote-Updates:** gestaffelt ausrollbar, rückrollbar, ohne Kundeneingriff.
- **Fern-Support:** Diagnose/Eingriff ohne Zugriff auf Kunden-Infrastruktur.
- **Backup/Restore** der lokalen DB.
- **Recovery/Ersatz:** Hub fällt aus → Filiale steht → Ersatzstrategie/SLA definieren.

---

## 5. Sicherheit

- Gehärtetes, gesperrtes OS (Appliance, kein Fremdsoftware-Zugriff), minimale Angriffsfläche
- Netz-Isolation der Satelliten
- DB-Verschlüsselung at-rest erwägen (PII, Kassen-/Audit-Daten)
- Keine Secrets im Image (BWS zur Laufzeit)

---

## 6. Die offene Entscheidung: Liefermodell

Die Achse, an der **Support-Last, Marge, Haftung und Kontrolle** hängen:

| Modell | Vorteil | Risiko / Preis |
|---|---|---|
| **A) BYO — Kunde nutzt eigenen PC** | keine Hardware-Logistik, billig | heterogene HW/OS → **Support-Hölle**, Updates unkontrollierbar, unzuverlässiges Kassen-/Fiskal-Verhalten, Haftungsfragen |
| **B) Managed Appliance — ihr liefert vorkonfiguriert** | volle Kontrolle, Zero-Touch, klares SLA, Hardware-Marge | Logistik, Lager, **RMA/Garantie**, Kapitalbindung, Lieferketten |
| **C) Whitelist — zertifizierte HW-Liste + euer Image** | Mittelweg, geringeres Kapital | Image-Pflege je Gerät, Graubereich-Support bei „fast passender" HW |

### Zu bewertende Dimensionen (für die Recherche)

Support-Last & Fernwartbarkeit · Update-Kontrolle · Stückkosten & Marge · Logistik/RMA ·
rechtliche Haftung (KassenSichV/TSE-Verantwortung) · Skalierung über viele Filialen ·
Rückwirkung auf das `offlinePos`/Operate-Tier-Pricing.

### Konkrete HW-Kandidaten (zu recherchieren)

- fanless x86 Mini-PC (Intel N100-Klasse)
- Industrie-SBC (lüfterlos, Weitbereichs-Temperatur)
- ARM-SBC (CM4 / Rockchip) — Achtung glibc/ARM64-Build verifizieren

Jeweils mit Blick auf: Verfügbarkeit, Langzeit-Liefergarantie, Temperaturbereich,
Garantie/RMA-Konditionen, eMMC/SSD-Qualität, Watchdog/Auto-Power-On.

---

## 7. Was im Code bereits existiert (Wiederverwendung)

- `apps/api-edge/` — FeathersJS + SQLite, **bereits containerisiert** (Docker, glibc)
- **Cloud-Pairing-Wizard** (`cloud-pairing-wizard.md`) — Provisioning-Grundlage
- **Heartbeat / `/health` / `device-connections`** — Monitoring-Grundlage
- **Sync** (Outbox/Cursor/Conflicts) — Cloud-Gateway-Grundlage
- **BWS-Secrets-Pattern** — Secret-Handling auf dem Gerät
- **Subscription-Tiers** (`subscription-tier-modell.md`) — `offlinePos`/`physicalPrintServer`
  als Operate-Capability, also kommerzieller Anker des Hubs

---

## 8. Offene Fragen für die Recherche/Planung

1. Welches Liefermodell (A/B/C) — und warum? Empfehlung mit Begründung.
2. Konkrete HW-Empfehlung(en) inkl. Preisrahmen, Verfügbarkeit, Langzeit-Support.
3. OS-/Provisioning-Stack: gehärtetes Linux-Image vs. Fleet-OS (z. B. balenaOS,
   Yocto, Ubuntu Core) — Fernverwaltung & Update-Mechanik.
4. Update-/Rollback-Strategie für eine Geräteflotte.
5. Recovery-/Ersatz-Konzept bei Hub-Ausfall (Filiale darf nicht stehen) + SLA.
6. Rechtliche Verantwortung (KassenSichV/TSE) je Liefermodell.
7. Backup-Strategie der lokalen DB.
8. Kostenmodell: Hardware + Logistik + Support → Auswirkung auf Operate-Tier-Pricing.
