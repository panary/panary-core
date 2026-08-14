---
type: Report
title: Der lokale Security-Scan lief blind — osv-scanner v2 und die verschluckten Fehlschläge
description: scripts/security-scan.mjs rief osv-scanner in der v1-Syntax auf, fing den Exit 127 ab und meldete danach „Total findings: 0" mit Exit 0 — der pre-push-Gate war seit dem Wechsel auf v2 ein reiner Secret-Scan; Aufruf korrigiert und jeder ergebnislose Scanner erzwingt jetzt Exit 2.
tags: [security, supply-chain, tooling, gates]
status: stable
generated: { by: claude-code/opus-5, at: 2026-08-14T15:42:38.000Z }
---

# Der lokale Security-Scan lief blind — osv-scanner v2 und die verschluckten Fehlschläge

## Der Befund

`scripts/security-scan.mjs` rief osv-scanner in der **v1-Syntax** auf:

```js
spawnSync('osv-scanner', [`--lockfile=${lockfile}`, '--format=json', repoRoot], …)
```

Lokal installiert ist osv-scanner **2.3.8** — genau das, was
`scripts/install-security-tools.sh` per `brew install osv-scanner` liefert. Dort endet
dieser Aufruf mit **Exit 127**:

```
could not determine extractor suitable to this file: "…/pnpm-lock.yaml"
```

Ein lauter Fehlschlag wäre folgenlos geblieben. Der Schaden entstand eine Zeile
später: `runOsvScanner()` loggte den Fehler rot und gab danach `[]` zurück —
ununterscheidbar von „sauber gescannt". Das Skript zählte weiter und meldete
**„Total findings: 0" mit Exit 0**.

Gemessen am 2026-08-14: Das Skript meldete 0 Findings, während ein direkter Lauf
`GHSA-2v37-7h3g-55p8` (nanoid 3.3.17, CVSS 8.2) fand — denselben Befund, den
[#193](https://github.com/panary/panary-core/issues/193) behebt und dessen
Checkliste den lokalen Scan als Nachweis führt.

## Warum es niemandem auffiel

Der Gate hat zwei Konsumenten, und der laute war gesund:

| Kanal | Zustand | Warum |
| --- | --- | --- |
| CI (`.github/workflows/security.yml`) | in Ordnung | nutzt `google/osv-scanner-action@v2.3.8`, nie dieses Skript |
| pre-push (`lefthook.yml`) | **blind** | `pnpm security:scan --mode=local --quiet --max-severity=critical` |
| Vor-PR-Handgriff (Issue-Checklisten) | **blind** | „`node scripts/security-scan.mjs` lokal grün" |

Die CI meldete Befunde weiterhin korrekt — deshalb wirkte das Gesamtbild stimmig.
Faktisch war der pre-push-Hook seit dem Sprung auf osv-scanner v2 ein reiner
Secret-Scan: die SCA-Hälfte lief nicht und meldete trotzdem grün. Wie lange, lässt
sich nicht mehr feststellen; das Fenster beginnt beim lokalen Homebrew-Wechsel auf
v2 und ist nicht datierbar.

**Die eigentliche Lehre ist nicht die Syntax, sondern die Bilanz.** Ein Werkzeug-Update
bricht einen Aufruf — das ist Alltag und wäre in Minuten behoben. Teuer wurde es
dadurch, dass der Fehlschlag in denselben Rückgabewert mündete wie ein sauberer Lauf.
Ein Gate, das seinen eigenen Ausfall als Entwarnung meldet, ist schlechter als kein
Gate: Es beantwortet eine Frage, die es nicht gestellt hat.

## Der Aufruf unter v2

Gemessen wurde jede Variante, statt aus der Hilfe abgeleitet:

| Aufruf | Ergebnis |
| --- | --- |
| `--lockfile=<pfad> --format=json <dir>` (v1) | **Exit 127**, „could not determine extractor" |
| `scan source --lockfile <pfad> --format json <dir>` | **Exit 127**, identisch |
| `scan source --format json <dir>` | **Exit 128**, „No package sources found" |
| `scan source --lockfile <pfad> --format json` | **Exit 1**, gültiges JSON ✅ |

Zwei Fallen stecken darin. Erstens ist das positionale Verzeichnis nicht bloß
überflüssig: Zusammen mit `--lockfile` bringt es die Extraktion der explizit
genannten Datei zum Scheitern — die naheliegende 1:1-Übersetzung reproduziert also
exakt den Fehler, den sie beheben soll. Zweitens findet das Verzeichnis allein gar
nichts, weil v2 den Git-Root überspringt, solange `--include-git-root` nicht gesetzt
ist. Der Lockfile-Pfad allein ist die funktionierende Form; `osv-scanner.toml` wird
weiterhin gefunden, es wird neben dem Lockfile aufgelöst.

Die JSON-Struktur ist unverändert (`results[].packages[].vulnerabilities[]`,
`groups[].max_severity`) — die Parse-Hälfte des Skripts blieb unangetastet.

## Die Fehlerbilanz

Jeder Scanner meldet seinen Ausfall jetzt an eine gemeinsame Bilanz, statt ihn in
`return []` zu begraben. Betroffen sind alle vier Quellen: osv-scanner, gitleaks und
die beiden `gh`-Pfade (code-scanning, dependabot). Als Ausfall zählt auch ein
**nicht installiertes** Werkzeug — „Total findings: 0" ohne osv-scanner ist dieselbe
falsche Sicherheit wie ein abgestürzter Lauf.

Daraus folgt der Exit-Code-Vertrag:

| Exit | Bedeutung |
| --- | --- |
| 0 | jeder angeforderte Scanner hat geliefert, nichts über `--max-severity` |
| 1 | Funde ≥ `--max-severity` |
| 2 | Aufruffehler, **oder** ein angeforderter Scanner ohne Ergebnis |

Exit 2 sticht Exit 1: Wenn ein Scanner nicht gelaufen ist, ist die Fundliste eine
Untergrenze, und „nichts über der Schwelle" ist keine Aussage, auf die jemand bauen
sollte. Alle drei Ausgabeformate sagen das auch — die Konsole mit einem
`⚠ UNVOLLSTAENDIGER LAUF`-Block, Markdown mit einem Zitatblock, JSON mit
`complete: false` und einem `scanErrors`-Array.

**Fehlermeldungen umgehen `--quiet` bewusst.** Der pre-push-Hook läuft mit `--quiet`;
eine dort verschluckte Begründung hätte die stille Lücke nur gegen eine stille Sperre
getauscht. Aus demselben Grund schreibt auch die `--max-severity`-Meldung jetzt direkt
nach stderr — sie lief vorher durch `log()` und wäre im Hook unsichtbar geblieben.

## Was das nicht löst

- **Ein künftiger v3-Syntaxbruch fällt genauso aus.** Der Fix macht den Ausfall
  sichtbar, verhindert ihn nicht; eine Versionsprüfung gibt es nicht.
- **Kein Test deckt das Skript ab**, und es läuft in keiner Pipeline. Eine grüne CI
  beweist über diesen Pfad nichts.
- **Der Rückstand ist nicht rekonstruierbar** — wie viele Befunde der Gate in seiner
  blinden Zeit durchgelassen hat, lässt sich nachträglich nicht bestimmen.
- **Gemessen wurde nur macOS/Homebrew mit 2.3.8.** Linux-Installationen sind ungetestet.
- **Im Haupt-Checkout ist die Scan-Fläche eine andere:** dort ist `pnpm-lock.yaml` ein
  Symlink aufs Workbench-Root-Lockfile, das am 2026-08-14 zwei Criticals führte
  (`tar@7.5.13`, `websocket-driver@0.7.4`, je CVSS 9.2). Im Worktree — wo laut
  Workflow-Konvention gearbeitet wird — greift das eigene, standalone Lockfile mit
  0 Criticals. Ein Push aus dem Haupt-Checkout wird also ab jetzt blockiert. Die beiden
  Befunde sind ein eigener, offener Punkt und in diesem Zug nicht behandelt.

## Verwandt

- [OSV-Befund 2026-08-07](osv-befund-2026-08-07.md) — dieselbe Klasse: ein grüner Scan
  von gestern sagt nichts über heute
- Schwesterfix in panary-cloud: [panary/panary-cloud#274](https://github.com/panary/panary-cloud/issues/274)
  (die Datei ist in beiden Repos byte-identisch)
