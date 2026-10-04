---
type: Guide
title: Installer-Drift — get.panary.cloud gegen main
description: Der Upload von install.sh und index.html nach Bunny bleibt Handarbeit; ein täglicher Workflow vergleicht die ausgelieferten Dateien mit main und öffnet bei Abweichung genau ein Issue, das sich nach dem Upload selbst schließt — Benachrichtigung, kein Gate.
tags: [infra, deployment, ci, api-edge]
status: stable
generated: { by: claude-code/opus-5, at: 2026-10-04T08:30:00.000Z }
sources:
  - { id: skript, resource: scripts/installer-drift.mjs, title: Abgleich und Issue-Entscheidung }
  - { id: spec, resource: scripts/installer-drift.spec.mjs, title: Tests der Entscheidung }
  - { id: workflow, resource: .github/workflows/installer-drift.yml, title: Workflow Installer-Drift }
  - { id: hosting, resource: tools/hosting/README.md, title: Installer-Hosting }
---

# Installer-Drift — get.panary.cloud gegen `main`

## Warum es das gibt

`tools/hosting/get.panary.cloud/` wird **von Hand** in die Bunny-Storage-Zone geladen. Keine CI
lädt es hoch. Am 2026-10-03 lieferte `https://get.panary.cloud/install.sh` noch den Stand vom
2026-08-04 aus. Jede Neuinstallation bekam damit weder den Watchtower-Fix
([Edge-Auto-Update](edge-auto-update-watchtower.md)) noch die Secret-Härtung
([FEATHERS_SECRET-Pflicht](edge-feathers-secret-pflicht.md)). Das blieb wochenlang unbemerkt
([#540](https://github.com/panary/panary-core/issues/540)).

## Entscheidung: melden, nicht hochladen

Der Upload bleibt manuell (Michael, 2026-10-04). Ein Upload aus der CI hieße, einen
Bunny-Schlüssel ins Repo zu legen. Das Skript läuft aber per `curl | sudo bash` als root auf
jedem neuen Edge: Wer diesen Weg kontrolliert, hat Root auf jedem neuen Edge. Automatisiert ist
deshalb nur die Benachrichtigung.

## Was der Workflow tut

`.github/workflows/installer-drift.yml` läuft **täglich um 06:23 UTC**, bei jedem Push auf `main`
unter `tools/hosting/get.panary.cloud/` und per `workflow_dispatch`. Er vergleicht für
`install.sh` und `index.html` den Git-Blob-Hash der ausgelieferten Datei mit dem aus `main`.
Verglichen werden Bytes: Eine reine Umformatierung im Repo meldet sich auch.

| Messung | Wirkung |
| --- | --- |
| Alle Dateien gleich | offenes `installer-drift`-Issue wird mit Kommentar geschlossen |
| Eine Datei weicht ab, kein Issue offen | **ein** Issue mit Label `installer-drift`, zugewiesen an `michaelratke` |
| Eine Datei weicht ab, Issue schon offen | nichts, also kein zweites Issue |
| Eine Datei nicht erreichbar, sonst nichts abweichend | nur ein Vermerk in der Job-Summary, kein Issue |

Der Lauf bleibt bei einer Abweichung **grün**. Rot wird er nur, wenn das Werkzeug selbst scheitert,
etwa `gh` oder der Checkout.

Der Push-Trigger ist Absicht: Nach einem Merge, der `install.sh` ändert, ist die Datei live
veraltet. Das Issue erscheint dann sofort als Erinnerung zum Hochladen.

## Nach dem Upload

1. Dateien aus `tools/hosting/get.panary.cloud/` in die Storage-Zone laden.
2. **Den Pull-Zone-Cache leeren.** Ohne das liefert Bunny weiter den alten Stand aus, und ein
   Query-String umgeht den Cache nicht (gemessen am 2026-10-04).
3. Workflow „Installer-Drift" per `workflow_dispatch` starten. Er schließt das Issue, sonst tut es
   der nächste tägliche Lauf.

Selbst nachmessen:

```bash
curl -fsSL https://get.panary.cloud/install.sh | git hash-object --stdin
git rev-parse origin/main:tools/hosting/get.panary.cloud/install.sh
```

## Was es nicht sieht

- Ob ein **ausgelieferter** Installer auch funktioniert. Gemessen wird nur Gleichheit mit `main`.
- Edges, die mit einem veralteten Installer aufgesetzt wurden. Dort hilft nur ein Blick auf den
  Edge selbst, z. B. `docker inspect panary-watchtower`.
- Weitere Dateien im Storage. Verglichen wird nur, was in `DATEIEN` in `scripts/installer-drift.mjs`
  steht. Eine neue Datei unter `tools/hosting/get.panary.cloud/` gehört dort eingetragen.
- Abweichungen innerhalb eines Tages, außer nach einem Push auf `main`.
