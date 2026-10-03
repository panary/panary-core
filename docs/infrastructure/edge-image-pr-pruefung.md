---
type: Guide
title: Edge-Image-Prüfung — PR, main-Push und Release: was sie baut, wann sie läuft, was sie nicht sieht
description: Das Edge-Image wird gebaut und per Smoke-Test gestartet: im PR, sobald er den Docker-Build-Kontext berührt, auf jedem main-Push ohne Filter und im Release vor dem Push; dieselbe Kontext-Vorbereitung überall, Pfadfilter mit gemessener Trefferquote, und die Lücken, die ein grüner Lauf offen lässt.
tags: [ci, docker, edge, gates]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-10-03T08:00:00Z }
---

# Edge-Image-Prüfung — PR, main-Push und Release

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
([#497](https://github.com/panary/panary-core/issues/497)) baut bei `pull_request` und
bei jedem Push nach `main` das **ganze** Image (Build- und Runtime-Stage) für `linux/amd64`, mit `push: false`. Keine
Registry-Anmeldung, keine Signatur, keine Stückliste, nur `contents: read`.

Die Kontext-Vorbereitung (Workspace-Globs, `.npmrc`, echte Lockfile, `.dockerignore`)
liegt in `tools/docker/prepare-edge-context.sh`. Release (`build-edge-docker.yml`) und
PR-Prüfung rufen beide dieses Skript auf. Zwei Kopien würden driften, und der PR wäre
dann grün gegen einen Kontext, den es im Release nicht gibt.

Die Runtime-Stage ist mitgebaut statt nur `--target build`: Sie besteht aus ein paar
`COPY --from` und einem `apt-get`, kostet also Sekunden und fängt einen fehlenden
`dist`-Pfad ab.

Der GHA-Layer-Cache wird nur gelesen (`cache-from`), nicht geschrieben, im PR wie auf
`main`. Ein PR-Eintrag wäre nur für denselben PR lesbar und belegte das 10-GB-Kontingent.
Was der Release schreibt, liegt unter dem Tag-Ref und ist für PR- und `main`-Läufe nach den
Scoping-Regeln von GitHub vermutlich nicht lesbar. Diese Läufe bauen dann weitgehend kalt
(gemessen 4:20 bis 4:50 min).

## Smoke-Test

Seit [#505](https://github.com/panary/panary-core/issues/505) lädt der Job das Image in den
Docker des Runners und startet es per `tools/docker/smoke-edge-image.sh` zweimal:

| Lauf | Aufbau | Erwartung |
| --- | --- | --- |
| Produktionsmodus | `panary.config.json` mit `{}` im Datenverzeichnis, zufälliges `FEATHERS_SECRET` | `/health`: `status: ok`, `version` = Build-Argument (`pr-check`), Feld `systemMode` vorhanden (gibt es nur im Produktionsmodus). `/admin/`: 200, HTML mit `<app-root`. Nach 8 s keine Log-Zeile mit `MODULE_NOT_FOUND`/`Cannot find module` |
| Setup-Modus | leeres Datenverzeichnis | `/api/system-info`: `status: unconfigured`, keine Log-Zeile mit fehlendem Modul |

Schon die Existenz der Config wählt den Produktionsmodus (`apps/api-edge/src/main.ts`).
Damit laufen Migrationen und Service-Registrierung. Fehlt dort ein Modul, stirbt der
Container. Was `main.ts` erst **nach** dem ersten `/health` per `import()` nachlädt
(Admin-Check, Geschäftstag, Print-Server, mDNS), fängt es selbst ab, ohne Exit. Deshalb
wartet das Skript danach 8 s und sucht in den Logs gezielt nach fehlenden Modulen. Ein
pauschaler Scan auf `"level":"error"` ginge nicht: Ein frischer Edge ohne Admin meldet
`bootstrap.admin_access_missing` zu Recht.

Jede verfehlte Erwartung wird als `::error::` gemeldet. Beide Läufe laufen trotzdem durch,
am Ende steht Exit 1, und von jedem fehlgeschlagenen Container stehen die letzten 80 Zeilen
`docker logs` im Schritt-Log. Lokal läuft das Skript gegen jedes gebaute Image, der Aufruf
steht in seinem Kopf.

Mutationsproben am lokal gebauten Image (2026-10-03, alle Exit 1 mit der genannten
Meldung, die Gegenprobe Exit 0 in 7,8 s): Admin-SPA entfernt (`/admin/` → 404), falsche
erwartete Version, `knex` entfernt (Container stirbt beim Boot, `MODULE_NOT_FOUND` im Log),
`bonjour-service` entfernt (Boot und `/health` grün, gefunden nur über den Log-Scan),
nicht vorhandenes Image.

## Wann er läuft

**Auf jedem Push nach `main`, ohne Filter** (seit
[#508](https://github.com/panary/panary-core/issues/508)). Grund: Eine reine
Code-Änderung kann das Image brechen, ohne eine Filterdatei zu berühren. Alle
Abhängigkeiten stehen in der Root-`package.json`, und das Image entfernt per
`pnpm prune --prod` die `devDependencies`. Importiert ein PR in `apps/api-edge/src/` oder
einer Lib ein Paket, das nur dort steht, sind Lint, Tests und Build grün (im Checkout ist
es da), im Image fehlt es. Der `main`-Lauf meldet das nach dem Merge, spätestens aber vor
dem nächsten `v*`-Release. Er wird nie abgebrochen, auch nicht von einem neueren Push: Der
Lauf, der einen Bruch als erster zeigt, soll stehen bleiben. Den Filter stattdessen auf
`apps/api-edge/src/**` und `libs/**` zu erweitern, träfe fast jeden PR.

**Im PR** gilt der native `paths:`-Filter des Workflows. Das Ruleset von `main` kennt keine Pflicht-Checks,
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

## Im Release vor dem Push

`build-edge-docker.yml` startet seit #508 genau das Release-Image, **bevor** es die Registry
erreicht. Bei einem `v*`-Tag bewegt der Push `:latest`, und Watchtower rollt das binnen
einer Stunde auf jeden Kunden-Edge aus. Der grüne PR-Lauf deckt das nicht ab: Er hat einen
anderen Stand gestartet, ohne das, was danach nach `main` kam.

Ablauf: bauen und in den Docker des Runners laden (`panary-edge:release-check`),
`smoke-edge-image.sh` mit der Release-Version als Erwartung, erst dann der bestehende
„Build and Push“. Der baut aus demselben Builder-Cache, kompiliert also nicht noch einmal,
und pusht per Buildx, weil Signatur und Provenance an dessen Digest hängen. Gepusht wird
damit ein Neubau aus denselben Layern, nicht das geladene Image selbst. Der Digest kann
sich deshalb vom geladenen Image unterscheiden (Attestations, Index), der Inhalt nicht. Schlägt der
Smoke-Test fehl, bricht der Job vor dem Push ab: Kein Tag, kein `:latest`, kein Rollout.
`publish-libraries.yml` hängt nicht an diesem Job und publiziert trotzdem.

## Was ein grüner Lauf nicht zeigt

- **Fachliches Verhalten.** Der Smoke-Test (oben) belegt den Boot, nicht Pairing,
  Cloud-Verbindung, Login oder Hardware (Drucker, TSE). Ein Fehler, den `main.ts` nach dem
  Boot abfängt und der kein fehlendes Modul ist, bleibt ebenfalls grün.
- **Signatur, Provenance, Stückliste und Advisory-Scan.** Die laufen nur im Release-Workflow.
- **Im PR: Brüche über Pfade außerhalb des Filters.** Die fängt erst der `main`-Lauf, also
  nach dem Merge. Kopiert das Dockerfile künftig etwas Neues (wie damals `tools/vitest/`),
  gehört der Pfad in den Filter, damit es schon der PR sieht. Dasselbe gilt für eine neue
  Root-Konfiguration, die das `@nx`-Plugin beim Graph-Aufbau liest.
- **Den Rollout.** Ob die Kunden-Edges das neue Image tatsächlich ziehen und melden, prüft
  keiner dieser Läufe.
