---
type: Reference
title: 'Hand-off-Prompt — Recherche zum Filial-Hub-Liefermodell'
description: Der Übergabetext, mit dem die Recherche zum Filial-Hub-Liefermodell in einer eigenen Sitzung gestartet werden sollte.
tags: [sync, devices]
status: draft
generated: { by: claude-code/opus-5, at: 2026-05-29T00:00:00.000Z }
sources:
  - id: anforderungen
    resource: ../architecture/filial-hub-anforderungen.md
    title: Filial-Hub — Anforderungen
---

> **Gespiegeltes Material** im Sinne von `.claude/rules/documentation.md` §1: ein Handoff, kein
> Konzept. Die inhaltliche Grundlage steht in
> [Filial-Hub — Anforderungen](../architecture/filial-hub-anforderungen.md). Am 2026-08-08 aus
> `_WORKBENCH_PANARY/_planning/` übernommen; die Recherche wurde bis dahin nicht gestartet.

# Hand-off-Prompt (in neuen Chat kopieren)

> Den folgenden Block in einen frischen Chat im Workspace `_WORKBENCH_PANARY` einfügen.
> Der Agent hat dort Zugriff auf die Codebase und die `CLAUDE.md`-Regeln.

---

Du bist Architektur-/Go-to-Market-Berater für „Panary", eine Offline-First-POS-/ERP-Plattform.

**Aufgabe:** Recherchiere und plane, wie wir einen **Filial-Hub (Edge-Server)** für
Kunden bereitstellen — die offene Kernfrage ist das **Liefer-/Vertriebsmodell** und
dessen operative Beherrschbarkeit (Auslieferung, Konfiguration, Fernwartung, Updates,
Support, Haftung).

**Pflichtlektüre zuerst (in dieser Reihenfolge):**
1. `_planning/pos-mobile-strategie/edge-hub-anforderungen.md` — die Anforderungen + die
   offene Liefermodell-Entscheidung (A BYO-PC / B Managed Appliance / C Whitelist).
   **Das ist dein primäres Briefing.**
2. `_planning/pos-mobile-strategie/mobile-pos-strategie-recherche.md` — Kontext, warum
   der Edge ein getiertes Capability-Upgrade ist (Connect vs. Operate).
3. `panary-core/CLAUDE.md` + `_WORKBENCH_PANARY/CLAUDE.md` — Projektregeln.
4. In der Codebase als Wiederverwendungs-Basis ansehen (nur lesen):
   `panary-core/apps/api-edge/`, `panary-core/documentation/cloud-pairing-wizard.md`,
   `print-server-api.md`, `subscription-tier-modell.md`, `fiskalisierung-architektur-adr.md`,
   `docker-native-module-fix.md`.

**Wichtige Rahmenbedingungen (verbindlich):**
- Die Verzeichnisse `panary/` und `smartfoodorders-server/` sind **Legacy — nur lesen,
  niemals schreiben/committen**.
- `api-edge` ist FeathersJS v5 + SQLite (better-sqlite3 = natives Modul, glibc/bookworm),
  **bereits containerisiert**. ABI-Kompatibilität (x86-64 vs. ARM64) ist ein hartes Kriterium.
- Online-TSE (Fiskaly) → **Offline-Signieren erfordert eine lokale/Hardware-TSE**; das ist
  unabhängig vom Hub und nur optional Teil des Hubs.
- Alle Doku/Planung **auf Deutsch** und **außerhalb der Repos** ablegen
  (`_planning/pos-mobile-strategie/`), **nicht** ins Git.

**Liefere als Ergebnis (eine neue Datei `_planning/pos-mobile-strategie/edge-hub-liefermodell-plan.md`):**
1. **Empfehlung** für ein Liefermodell (A/B/C oder Hybrid) mit klarer Begründung entlang
   der Dimensionen: Support-Last & Fernwartbarkeit, Update-Kontrolle, Stückkosten & Marge,
   Logistik/RMA, rechtliche Haftung (KassenSichV/TSE), Skalierung über viele Filialen,
   Rückwirkung auf das Operate-Tier-Pricing.
2. **Konkrete Hardware-Kandidaten** (Modelle, Preisrahmen, Verfügbarkeit, Langzeit-Liefer-
   garantie, Temperaturbereich, eMMC/SSD-Qualität, Watchdog/Auto-Power-On) — x86 N100-Klasse,
   Industrie-SBC, ggf. ARM (CM4/Rockchip, mit ABI-Vorbehalt).
3. **Provisioning-/Fleet-Stack:** gehärtetes Linux-Image vs. Fleet-OS (balenaOS, Ubuntu
   Core, Yocto …) — Bewertung für Fernverwaltung, Zero-Touch-Onboarding (an den vorhandenen
   Cloud-Pairing-Wizard andocken), Update-/Rollback-Mechanik.
4. **Recovery-/Ersatzkonzept** bei Hub-Ausfall (Filiale darf nicht stehen) inkl. SLA-Optionen
   und Backup-Strategie der lokalen DB.
5. **Kostenmodell** (Hardware + Logistik + Support) und dessen Auswirkung auf das Pricing.
6. **Risiken & offene Punkte**, klar markiert.

**Arbeitsweise:** Erst die Pflichtlektüre + relevanten Code sichten, dann Web-Recherche
für Hardware/Fleet-Management/Markt-Benchmarks (vergleichbare POS-Anbieter), dann den Plan
schreiben. Annahmen explizit machen. Wo eine Entscheidung mir (dem Auftraggeber) gehört,
nachfragen statt raten.
