---
type: Guide
title: Edge-Image-Prüfung im PR — was sie baut, wann sie läuft, was sie nicht sieht
description: Der Workflow edge-image-check.yml baut das Edge-Image ohne Push und startet es per Smoke-Test, sobald ein PR den Docker-Build-Kontext berührt; dieselbe Kontext-Vorbereitung wie der Release, Pfadfilter mit gemessener Trefferquote, und die Lücken, die ein grüner Lauf offen lässt.
tags: [ci, docker, edge, gates]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-03T08:00:00Z }
---

# Edge-Image-Prüfung im PR

## Problem

Die PR-CI (`ci.yml`) baut die Projekte im normalen Checkout, das Edge-Image aber nie.
Das Image löst den Workspace anders auf: `tools/docker/Dockerfile.edge` kopiert nur
Teile des Repos, der Workspace bekommt im CI zusätzliche `packages:`-Globs, und die
Lockfile wird für diesen Satz neu erzeugt. Was dort bricht, sieht `ci.yml` nicht.

So geschehen an [panary/panary-core#485](https://github.com/panary/panary-core/issues/485):
Die `vitest.config.mts` der Libs importierten `tools/vitest/`, das Dockerfile kopierte es
nicht, `nx build api-edge` brach im Image ab. Die PR-CI war grün. Aufgefallen ist es nur
durch einen zufälligen Dispatch ([#488](https://github.com/panary/panary-core/issues/488)),
sonst erst beim nächsten `v*`-Release, mit Lib-Publish ohne Image.

## Was läuft

`.github/workflows/edge-image-check.yml`
([#497](https://github.com/panary/panary-core/issues/497)) baut bei `pull_request` das
**ganze** Image (Build- und Runtime-Stage) für `linux/amd64`, mit `push: false`. Keine
Registry-Anmeldung, keine Signatur, keine Stückliste, nur `contents: read`.

Die Kontext-Vorbereitung (Workspace-Globs, `.npmrc`, echte Lockfile, `.dockerignore`)
liegt in `tools/docker/prepare-edge-context.sh`. Release (`build-edge-docker.yml`) und
PR-Prüfung rufen beide dieses Skript auf. Zwei Kopien würden driften, und der PR wäre
dann grün gegen einen Kontext, den es im Release nicht gibt.

Die Runtime-Stage ist mitgebaut statt nur `--target build`: Sie besteht aus ein paar
`COPY --from` und einem `apt-get`, kostet also Sekunden und fängt einen fehlenden
`dist`-Pfad ab.

Der GHA-Layer-Cache wird nur gelesen (`cache-from`), nicht geschrieben. Ein PR-Eintrag
wäre nur für denselben PR lesbar und verdrängte die Einträge der Releases aus dem
10-GB-Kontingent.

## Smoke-Test

Seit [#505](https://github.com/panary/panary-core/issues/505) lädt der Job das Image in den
Docker des Runners und startet es per `tools/docker/smoke-edge-image.sh` zweimal:

| Lauf | Aufbau | Erwartung |
| --- | --- | --- |
| Produktionsmodus | `panary.config.json` mit `{}` im Datenverzeichnis, zufälliges `FEATHERS_SECRET` | `/health`: `status: ok`, `version` = Build-Argument (`pr-check`), `database.type: sqlite`. `/admin/`: 200, HTML mit `<app-root` |
| Setup-Modus | leeres Datenverzeichnis | `/api/system-info`: `status: unconfigured` |

Schon die Existenz der Config wählt den Produktionsmodus (`apps/api-edge/src/main.ts`).
Damit laufen Migrationen und Service-Registrierung, also genau der Pfad, an dem ein zur
Laufzeit fehlendes Modul auffällt. Stirbt der Container oder antwortet er nicht innerhalb
von 90 s, bricht das Skript ab und gibt die letzten 80 Zeilen `docker logs` aus. Lokal
läuft es gegen jedes gebaute Image; der Aufruf steht im Kopf des Skripts.

## Wann er läuft

Der native `paths:`-Filter des Workflows. Das Ruleset von `main` kennt keine Pflicht-Checks,
ein PR ohne passende Pfade wartet also auf nichts. Wird der Check später zur Pflicht, braucht
er einen Ersatzlauf für ungefilterte PRs, sonst bleibt er dort auf „erwartet“ stehen.

Im Filter stehen die Dateien, die das Image anders auflöst als der Checkout: `tools/docker/**`,
`tools/vitest/**`, jede `vitest.config.*`, die Root-Konfiguration, die das Dockerfile kopiert
(`package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `nx.json`, `tsconfig*.json`,
`postcss.config.json`, `.gitignore`), `package.json`/`project.json` der Libs und der drei
gebauten Apps, `packages/**/package.json` sowie die beiden Workflows selbst.

**Gemessen** an den 80 gemergten PRs vor #497: Der Filter hätte **34** getroffen. Fast alle
sind Dependency-Bumps (`package.json` + Lockfile). Die wurden bewusst nicht ausgenommen:
Lockfile-Nachbau mit Karenz und native Module (`better-sqlite3`) brechen genau dort.
Der Lauf ist parallel zu `ci.yml` und verlängert die Wartezeit eines PRs nur, wenn er der
langsamere ist.

Nachmessen:

```bash
gh pr list --repo panary/panary-core --state merged --limit 80 --json number,files \
  --jq '.[]|"\(.number) \([.files[].path]|join(" "))"'
```

und die Pfade gegen die `paths:`-Liste halten.

## Was ein grüner Lauf nicht zeigt

- **Fachliches Verhalten.** Der Smoke-Test (unten) belegt den Boot, nicht Pairing,
  Cloud-Verbindung, Login oder Hardware (Drucker, TSE).
- **Signatur, Provenance, Stückliste und Advisory-Scan.** Die laufen nur im Release-Workflow.
- **Brüche über Pfade außerhalb des Filters.** Kopiert das Dockerfile künftig etwas Neues
  (wie damals `tools/vitest/`), muss der Pfad hier nachgetragen werden. Dasselbe gilt für
  eine neue Root-Konfiguration, die das `@nx`-Plugin beim Graph-Aufbau liest.
