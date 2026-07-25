# Dokumentation — OKF-Wiki (`/docs`) – Panary Core

Projektdoku lebt im Wiki `/docs`: ein OKF-v0.2-Bundle (Open Knowledge Format — Markdown +
YAML-Frontmatter), gepflegt von Agenten, kuratiert vom Nutzer. Einstieg: `docs/index.md`.
Historie: `docs/log.md`.

> **Hinweis:** Der frühere `/documentation`-Ordner wurde am 2026-07-25 vollständig in
> dieses Wiki migriert (Frontmatter `generated.by: claude-code/historic` markiert
> Alt-Bestand). Es gibt keinen zweiten Doku-Ort mehr.

---

## 1. Struktur

| Ordner | Inhalt | type-Werte (typisch) |
|---|---|---|
| `docs/adr/` | Architektur-Entscheidungen, `NNNN-<kebab>.md` fortlaufend | `ADR` |
| `docs/architecture/` | Architektur-Konzepte ohne Entscheidungscharakter | `Architecture` |
| `docs/domains/` | Domain-Konzepte & Business-Logik | `Domain Concept` |
| `docs/security/` | Sicherheit, RBAC, Härtung, Reviews | `Architecture`, `Report` |
| `docs/guides/` | Anleitungen, Runbooks, Setup, Smoke-Tests | `Guide` |
| `docs/infrastructure/` | CI, Docker, Deployment, Infra-Betrieb | `Guide`, `Architecture` |
| `docs/integrations/` | Externe Integrationen (APIs, Provider) | `Architecture`, `Reference` |
| `docs/references/` | Gespiegeltes Material: Handoffs, Assets, externe Spezifikationen | `Reference` |

Feinere Unterordner (z. B. `domains/orders/`) sind erlaubt; jeder Unterordner bekommt ein
eigenes `index.md`. Die reservierten Dateinamen `index.md` und `log.md` sind nie
Konzeptseiten. Frontmatter in Index-Dateien nur im Root-`docs/index.md` (`okf_version`).

---

## 2. Frontmatter (Hauskonvention, OKF-Profil)

Pflicht auf jeder Konzeptseite: `type`, `title`, `description`, `tags`, `status`, `generated`.

```yaml
---
type: ADR | Architecture | Domain Concept | Guide | Reference | Report | Plan
title: <Titel>
description: <genau ein Satz — wird in Indizes und Suche verwendet>
tags: [<domain>, ...]          # Domain-Namen wie in libs/domains/*, plus Querschnitts-Tags (ci, infra, sync, ...)
status: draft | stable | deprecated
generated: { by: <actor>, at: <ISO-8601> }
# optional:
# verified: { by: human:michael, at: <ISO-8601> }
# sources: [{ id: <slug>, resource: <URL|/pfad|repo-pfad>, title: <Label> }]
# stale_after: YYYY-MM-DD     # für zeitgebundene Aussagen (Pläne, Audits, Versionsstände)
---
```

- **Actors:** Agenten `claude-code/<modell>` (z. B. `claude-code/fable-5`), Nutzer
  `human:michael`, Prozesse `process:<id>`. `verified` nur setzen, wenn tatsächlich
  geprüft wurde — nie automatisch beim Generieren.
- **`status`** ist Doku-Lebenszyklus (draft = unfertig, stable = konsumierbar,
  deprecated = abgelöst), **kein Implementierungsstand**. Umsetzungsstand gehört in den
  Body oder als Extension-Feld (z. B. `implementation: released v26.7.30`).
- Abgelöste Doku: `status: deprecated` + Link auf den Nachfolger im Body — niemals löschen.
- Weitere Extension-Keys sind erlaubt (OKF-konform); unbekannte Keys nie entfernen.

---

## 3. ADRs

- Immer in `docs/adr/`, Dateiname `NNNN-<kebab-titel>.md` (nächste freie Nummer, vierstellig).
- `type: ADR` + Extension-Feld `decision: proposed | accepted | superseded | rejected`.
- Body-Gliederung: `## Problem` → `## Entscheidung` → `## Konsequenzen` (weitere Abschnitte erlaubt).
- Superseded: `decision: superseded`, `status: deprecated`, Link auf das Nachfolge-ADR.
- Entscheidungscharakter = „wir haben zwischen Alternativen gewählt und das bindet künftige
  Arbeit". Konzept-Beschreibungen ohne Wahl sind `Architecture`, keine ADRs.

---

## 4. Pflege-Pflicht (gleicher Commit wie die Änderung)

1. **Ordner-Index** und **Root-`docs/index.md`** aktualisieren
   (Eintragsformat: `* [Titel](pfad.md) - <description aus dem Frontmatter>`).
2. **`docs/log.md`** ergänzen — neuester Eintrag oben:
   `## YYYY-MM-DD` + `* **Creation|Update|Deprecation**: <Satz mit Link>`.
3. **Querverweise** setzen: relative Markdown-Links auf verwandte Konzepte (beide Richtungen
   prüfen). Links auf noch-nicht-geschriebene Konzepte sind erlaubt — sie markieren Bedarf.

---

## 5. Workflows

- **Ingest** (neues Wissen — Feature, Entscheidung, Erkenntnis): Konzeptseite im passenden
  Ordner anlegen/aktualisieren, betroffene Nachbarseiten mitziehen (Widersprüche auflösen,
  nicht stehenlassen), Indizes + Log pflegen.
- **Query:** Antworten mit bleibendem Wert (Vergleiche, Analysen, Entscheidungsgrundlagen)
  als Konzeptseite ins Wiki zurückschreiben, statt sie im Chat versickern zu lassen.
- **Lint** (auf Zuruf, z. B. „Wiki-Lint"): Widersprüche zwischen Seiten, überfällige
  `stale_after`, Orphans ohne eingehende Links, fehlende Querverweise, `draft`-Leichen —
  Befunde melden und nach Freigabe beheben.

---

## 6. Pflicht-Doku-Trigger

1. **Neues Feature/Domain:** Zweck, API-Übersicht, Nutzungsbeispiele
2. **Architekturänderung:** ADR (Problem → Entscheidung → Konsequenzen)
3. **Neuer Service:** Pfad, Methoden, Schemas, Hook-Chain, Besonderheiten
4. **Komplexe Business-Logik:** Berechnungsregeln, Randfälle, Beispiele
5. **Setup/Migration:** Schritt-für-Schritt-Anleitung
6. **Externe Integration:** Protokoll, Konfiguration, Fehlerbehandlung
7. **Breaking Changes:** Was ändert sich, Migrations-Schritte

**Sprache:** Deutsch. **Dateinamen:** `kebab-case`. Keine Doku-Dateien außerhalb von `/docs`
(Ausnahmen: `README.md`, `CLAUDE.md`, `.claude/`).
