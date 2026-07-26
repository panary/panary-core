# Dokumentation — OKF-Wiki (`/docs`) – Panary Core

Projektdoku lebt im Wiki `/docs`: ein OKF-v0.2-Bundle (Open Knowledge Format — Markdown +
YAML-Frontmatter), gepflegt von Agenten, kuratiert vom Nutzer. Einstieg: `docs/index.md`.
Historie: `docs/log.md`.

> **Hinweis:** Der frühere `/documentation`-Ordner wurde am 2026-07-25 vollständig in
> dieses Wiki migriert (Frontmatter `generated.by: claude-code/historic` markiert
> Alt-Bestand). Es gibt keinen zweiten Doku-Ort mehr.

---

## 0. Wo Pläne leben

- **Agenten-Arbeitspläne** (Plan-Modus, Session-Skizzen) leben **außerhalb des Repos**
  (Harness-verwaltet unter `~/.claude/plans/`) und werden **nie committet** — es gibt
  keinen `.claude/plans/`-Ordner im Repo.
- **Pläne mit bleibendem Wert** (Roadmaps, Living Plans, vertagte Ausbaustufen,
  Phasenpläne) gehören als Konzeptseite mit `type: Plan` ins Wiki (`docs/`, Ordner nach
  Thema) — inklusive Index-/Log-Pflege wie jede andere Konzeptseite.

---

## 1. Struktur

| Ordner                 | Inhalt                                                               | type-Werte (typisch)          |
| ---------------------- | -------------------------------------------------------------------- | ----------------------------- |
| `docs/adr/`            | Architektur-Entscheidungen, `NNNN-<kebab>.md` fortlaufend            | `ADR`                         |
| `docs/architecture/`   | Architektur-Konzepte ohne Entscheidungscharakter                     | `Architecture`                |
| `docs/domains/`        | Domain-Konzepte & Business-Logik                                     | `Domain Concept`              |
| `docs/security/`       | Sicherheit, RBAC, Härtung, Reviews                                   | `Architecture`, `Report`      |
| `docs/guides/`         | Anleitungen, Runbooks, Setup, Smoke-Tests                            | `Guide`                       |
| `docs/infrastructure/` | CI, Docker, Deployment, Infra-Betrieb                                | `Guide`, `Architecture`       |
| `docs/integrations/`   | Externe Integrationen (APIs, Provider)                               | `Architecture`, `Reference`   |
| `docs/references/`     | Gespiegeltes Material: Handoffs, Assets, externe Spezifikationen     | `Reference`                   |
| `docs/raw/`            | Unveränderliche Rohquellen (Originaldokumente) — siehe Hinweis unten | — (keine Frontmatter-Pflicht) |

Feinere Unterordner (z. B. `domains/orders/`) sind erlaubt; jeder Unterordner bekommt ein
eigenes `index.md`. Die reservierten Dateinamen `index.md` und `log.md` sind nie
Konzeptseiten. Frontmatter in Index-Dateien nur im Root-`docs/index.md` (`okf_version`).

`docs/raw/` ist die **Rohquellen-Schicht** (Karpathy Layer 1): unveränderliche Originaldokumente
(z. B. restaurierte Planungsunterlagen). **Nie editieren**, keine Frontmatter-Pflicht, kein
Prettier; Konzeptseiten verweisen per `sources` darauf. Neues Wissen fließt in Konzeptseiten.

---

## 2. Frontmatter (Hauskonvention, OKF-Profil)

Pflicht auf jeder Konzeptseite: `type`, `title`, `description`, `tags`, `status`, `generated`.

```yaml
---
type: ADR | Architecture | Domain Concept | Guide | Reference | Report | Plan
title: <Titel>
description: <genau ein Satz — wird in Indizes und Suche verwendet>
tags: [<domain>, ...] # Domain-Namen wie in libs/domains/*, plus Querschnitts-Tags (ci, infra, sync, ...)
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

---

## 7. Architekturmodell (LikeC4) — liegt in panary-cloud

Das LikeC4-Modell bildet das **Gesamtsystem** ab, also auch Edge, POS, Drucker und TSE. Es
liegt aus technischen Gründen im Nachbar-Repo (`panary-cloud/docs/architecture/c4/`) —
LikeC4 löst Referenzen nur innerhalb eines Verzeichnisbaums auf, ein repo-übergreifender
Landschafts-View braucht deshalb einen Eigentümer. Entscheidung:
`panary-cloud/docs/adr/0028-likec4-architecture-as-code.md`.

**Konsequenz für Arbeit in diesem Repo:** Berührt eine Änderung hier ein Element, eine
Grenze, ein Fremdsystem oder einen Ablauf, gehört die Modellpflege dazu — der Commit landet
dann in `panary-cloud`, nicht hier. Typische Auslöser:

- neuer Deployable oder Hintergrund-Worker mit Außenwirkung
- geänderter Sync-Pfad (Endpunkte, Allowlists, Transport) oder Pairing-Flow
- neuer öffentlich erreichbarer Endpunkt am Edge → `#public`
- Fiskalisierung: echter TSE-Adapter statt Simulator → `#planned`/`#partial` fällt weg
- neue externe Integration (Drucker-Protokoll, Provider, Discovery)

**Nicht** modellrelevant: Schema-Felder, Lint-/Style-Regeln, reines Refactoring, neue
Migrationen ohne Strukturwirkung.

> Das CI-Gate in `panary-cloud` (`arch:validate`) prüft nur, ob das Modell parst — **nicht**,
> ob es noch stimmt. Gegen Drift schützt allein diese Regel.

Vollständige Regeln: `panary-cloud/.claude/rules/documentation.md` §7.

---

**Sprache:** Deutsch. **Dateinamen:** `kebab-case`. Keine Doku-Dateien außerhalb von `/docs`
(Ausnahmen: `README.md`, `CLAUDE.md`, `.claude/`).
