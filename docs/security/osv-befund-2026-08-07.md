---
type: Report
title: OSV-Befund 2026-08-07 — nanoid gefixt, image-size als akzeptiertes Risiko
description: Zwei Advisory-Änderungen legten den nächtlichen OSV-Scan lahm; nanoid ist über einen exakt gepinnten Override geschlossen, für image-size existiert kein Fix und der Befund ist befristet als akzeptiertes Risiko dokumentiert.
tags: [security, supply-chain, dependencies, ci]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-11T11:20:00.000Z }
stale_after: 2026-11-07
---

# OSV-Befund 2026-08-07 — nanoid gefixt, image-size als akzeptiertes Risiko

## Auslöser: eine Datenbank-Änderung, kein Code-Regress

Der Job `osv-scanner (SCA)` war am Abend des 2026-08-07 in beiden Repos rot,
ohne dass jemand eine Abhängigkeit angefasst hatte — derselbe Branch war um
20:46 UTC grün und um 21:03 UTC rot, bei identischem Lockfile.

Die Ursache liegt in der OSV-Datenbank, nicht im Repo. Beide image-size-Advisories
tragen den `modified`-Stempel **2026-08-07T21:00 UTC**, sind aber schon am
2026-06-10 *veröffentlicht* worden. Neu war an diesem Abend also nicht das
Advisory, sondern seine npm-Range. Das ist der wichtigere Teil des Befunds:
**ein grüner Scan von gestern sagt nichts über heute**, auch bei eingefrorenem
Lockfile. Dieselbe Klasse von Ereignis wie der OSV-Sweep vom 2026-08-03, nur
über eine Modifikation statt über Neuveröffentlichungen.

| Advisory | Paket | CVSS | Fix |
| --- | --- | --- | --- |
| [GHSA-2v37-7h3g-55p8](https://osv.dev/GHSA-2v37-7h3g-55p8) | `nanoid@3.3.16` | 8.2 | 3.3.17 |
| [GHSA-5p2g-fcmc-qvqq](https://osv.dev/GHSA-5p2g-fcmc-qvqq) | `image-size@0.5.5` | 8.7 | — |
| [GHSA-w3rx-r6r6-pgpr](https://osv.dev/GHSA-w3rx-r6r6-pgpr) | `image-size@0.5.5` | 8.7 | — |

## nanoid — gefixt, mit exaktem Pin

`postcss@8.5.23` zieht `nanoid`; ein anderer Konsument existiert im Lockfile
nicht. Der Fix ist `3.3.17` (2026-08-03 10:39 UTC) und damit unter der
7-Tage-Karenz — ohne Ausnahme scheitert jede vollständige Neuauflösung mit
`ERR_PNPM_NO_MATURE_MATCHING_VERSION`. Der Eintrag steht deshalb befristet in
`minimumReleaseAgeExclude`, wie zuvor schon `fast-uri`, `hono` und `js-yaml`.

**Warum exakt `'3.3.17'` und nicht `'^3.3.17'`:** `nanoid@3.3.18` erschien am
2026-08-07 um 16:41 UTC. Ein Caret-Range hätte zusammen mit dem Exclude auf eine
zu diesem Zeitpunkt wenige Stunden alte Version aufgelöst — also genau auf das
Zeitfenster, gegen das die Karenz gebaut ist. Der exakte Pin nimmt stattdessen
die Version, die geprüft wurde und zum Zeitpunkt der Entscheidung vier Tage
öffentlich war.

> **Erledigt am 2026-08-11.** `nanoid` ist seit 2026-08-10 10:39 UTC reif; der
> Exclude ist entfernt und der Override auf `'^3.3.17'` gelockert. Die Karenz
> greift damit wieder und übernimmt die Rolle, die vorher der Exakt-Pin hatte:
> `^3.3.17` löst weiterhin auf **3.3.17** auf, weil `3.3.18` erst am 2026-08-14
> reif wird. Das Lockfile bewegt sich dadurch um genau eine Zeile (der
> `overrides:`-Kopf), die Resolution bleibt unverändert.

### Angriffsvorbedingung

Die Endlosschleife sitzt in `customRandom`/`customAlphabet` des
*secure*-Entrypoints: Bei `size = 0` wird `step = ceil(1.6 · mask · 0 / len) = 0`,
die innere Schleife läuft dadurch nie, und die äußere `while (true)` erreicht ihre
Abbruchbedingung nie. **Vorbedingung ist also ein eigener Generator, der eine
angreiferkontrollierte Größe 0 entgegennimmt.**

Im Repo gemessen: kein direkter `nanoid`-Import und keine Verwendung von
`customAlphabet`/`customRandom`. Der einzige Konsument `postcss` ruft
`nanoid(6)` aus `nanoid/non-secure` auf — fest verdrahtete Größe, eigener
Codepfad, kein Custom-Generator. Auf dem geprüften Aufrufpfad ist die
Vorbedingung damit nicht erfüllt; eine darüber hinausgehende Aussage zur
Ausnutzbarkeit ist nicht belegt und wird hier bewusst nicht getroffen.

## image-size — kein Fix, befristet akzeptiert

Beide Advisories melden `first_patched_version: null` bei
`vulnerable_version_range: <= 2.0.2`. Die neueste veröffentlichte Version **ist**
2.0.2 (npm-`latest`, 2025-04-02) — es gibt keine unbetroffene Version. Ein
`less`-Bump hilft ebenfalls nicht: sowohl `less@4.5.1` als auch das neuere
`less@4.6.4` führen `image-size@0.5.5` als `optionalDependency`.

Herkunft: `less` ist Pflicht-Peer von `less-loader@12.3.3`, das als Dependency an
`@nx/rspack` und `@nx/webpack` hängt — reines Build-Tooling.

### Angriffsvorbedingung

Vorbedingung ist ein **angreifergelieferter Bildpuffer**, der die JXL/HEIF- bzw.
ICNS-Parser erreicht. `less` ruft `image-size` ausschließlich aus den
Less-Funktionen `image-size()`, `image-width()` und `image-height()` auf. Im
Workspace gemessen: **0 `.less`-Dateien** und **0 Vorkommen dieser drei
Funktionen** in den Quellen. Auf dem geprüften Aufrufpfad erreicht damit kein
Eingabedatum den Parser. Auch hier gilt: belegt ist der untersuchte Pfad, nicht
die Abwesenheit jeder denkbaren Erreichbarkeit.

Der Befund steht deshalb befristet bis **2026-11-07** in `osv-scanner.toml`.
Dass die Frist abläuft, ist beabsichtigt — sie erzwingt die erneute Prüfung,
statt den Eintrag stillschweigend altern zu lassen.

> **Wichtig zur Reichweite der Datei:** osv-scanner sucht seine Konfiguration nur
> im Verzeichnis des gescannten Manifests und vererbt sie **nicht** an
> Unterverzeichnisse. `osv-scanner.toml` im Repo-Root deckt das
> `pnpm-lock.yaml` daneben ab — nicht mehr. Die Cargo-Ausnahmen des Tauri-Stacks
> stehen aus demselben Grund weiterhin getrennt in
> `apps/pos-client/src-tauri/osv-scanner.toml`.

## Aufräum-Termine

- ~~**Ab 2026-08-10 10:39 UTC:** `nanoid` aus `minimumReleaseAgeExclude`
  entfernen **und** den Override von `'3.3.17'` auf `'^3.3.17'` lockern.~~
  **Erledigt am 2026-08-11** — zusammen mit den drei übrigen abgelaufenen
  Befristungen (`fast-uri`, `js-yaml`, `hono`). `minimumReleaseAgeExclude` trägt
  damit wieder nur den dauerhaften `'@panary/*'`-Eintrag.
- **Bis 2026-11-07:** image-size neu bewerten. Früher handeln, sobald ein Fix
  erscheint oder `.less`-Dateien in den Workspace einziehen — dann wird der
  Parser real erreichbar und die Einordnung oben fällt.

## Verifikation

`osv-scanner` überspringt Punkt-Verzeichnisse; ein Lauf in einem Worktree
unterhalb von `.claude/` scannt nichts und meldet trotzdem „No issues found".
Die Gegenprobe gehört deshalb außerhalb:

```bash
osv-scanner scan source --lockfile pnpm-lock.yaml
```

Erwartung: `No issues found`, und in der Ausgabe erscheinen beide
image-size-IDs als `filtered out` — **kein** `has unused ignores`. Ein toter
Ignore ist nicht bloß Kosmetik: Er unterdrückt das Advisory auch dann, wenn
dasselbe Paket später über einen anderen Pfad zurückkommt. osv-scanner quittiert
unbenutzte Ignores mit Exit-Code 0, das Gate bliebe also fälschlich grün.

Verwandt: [Cargo-Advisories triagieren](../guides/cargo-advisory-triage.md),
[ADR 0012 — pnpm-Supply-Chain-Härtung](../adr/0012-pnpm-supply-chain-haertung.md).
Das Pendant in panary-cloud (`docs/security/osv-befund-2026-08-07.md`) behandelt
denselben Befund für die dortigen zwei Lockfiles und das zusätzliche
`pnpm audit`-Gate.
