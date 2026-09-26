---
type: Architecture
title: CI-Log — der Exit von Nx schnitt die letzte Task-Gruppe ab
description: Warum die Gruppe von api-edge:test im CI-Log in ganzen 64-KiB-Stücken abbrach — `process.exit()` an einer Pipe, keine Nx-Grenze —, wie oft das über 100 Läufe passierte, warum main-Pushes ohne Remote-Cache-Retry verschont blieben und wie der CI-Schritt es über eine Datei löst.
tags: [ci, infra, nx, testing]
status: stable
generated: { by: claude-code/opus-5.5, at: 2026-09-26T12:00:00Z }
sources:
  - id: issue-409
    resource: https://github.com/panary/panary-core/issues/409
    title: Messung über 100 CI-Läufe, Plan und CI-Beleg
  - id: run-36229949899
    resource: https://github.com/panary/panary-core/actions/runs/36229949899
    title: main-Push mit Remote-Cache-Retry — die api-edge:test-Gruppe endet in `stdou`
  - id: cloud-596
    resource: https://github.com/panary/panary-cloud/issues/596
    title: Derselbe Befund in panary-cloud (Fix panary/panary-cloud#606)
---

# CI-Log — der Exit von Nx schnitt die letzte Task-Gruppe ab

Im Schritt „Lint, Test, Typecheck & Build (affected)" von `.github/workflows/ci.yml` brach die
Nx-Gruppe des zuletzt fertigen Tasks mitten in einer Zeile ab — kein Vitest-Fazit, kein
`##[endgroup]`, keine Nx-Schlusszeile. Der Schritt stand trotzdem richtig auf grün oder rot, der
Exit-Code war nie betroffen. Es fehlte der Grund: Bei einem roten api-edge:test hätte der
Fehlerblock im Log gefehlt. Behoben in [#409](https://github.com/panary/panary-core/issues/409);
panary-cloud hatte denselben Befund (panary/panary-cloud#596).

## Der Mechanismus: `process.exit()` an einer Pipe

1. `nx affected` ruft direkt nach dem letzten Task `process.exit(status)` auf, `nx run-many`
   ebenso. In nx 22.7.12 steht das vorgesehene `await output.drain()` in
   `command-line/affected/affected.js` **hinter** dem Exit (Zeile 52 gegen 57) und wird nie
   erreicht. Erst nx 23.2 wartet vorher — und dann nur auf stdout und nur, wenn
   `writableNeedDrain` gesetzt ist.
2. An einer Pipe schreibt Node auf POSIX **asynchron**: Ein `write()` übergibt dem Kernel, was
   in die Pipe passt (unter Linux 16 Seiten zu 4 KiB, also 64 KiB), den Rest hält libuv in einer
   Warteschlange. `process.exit()` verwirft diese Warteschlange. In eine Datei schreibt Node
   dagegen synchron.
3. Die Ausgabe eines Tasks sammelt Nx im Speicher und schreibt sie bei Task-Ende in **einem**
   Stück in die Gruppe (`output.logCommandOutput`). Beim zuletzt fertigen Task geschieht das
   unmittelbar vor dem Exit. Durch kommen ganze Pipe-Füllungen.
4. Die Schlusszeile schreibt Nx bei Erfolg per `output.success()` auf stdout — sie steht hinter
   dem Rest in derselben Warteschlange und geht mit verloren. Bei Fehlschlag schreibt
   `output.error()` auf stderr, aus einer eigenen, leeren Warteschlange; sie überholt den Rest und
   steht im Log direkt hinter dem Schnitt.

Der Schritt leitete Nx per `2>&1 | tee "$log"` in eine Pipe. `tee` wegzulassen hätte nichts
geändert: Auch der Runner liest stdout über eine Pipe.

## Gemessen: 100 CI-Läufe vom 2026-09-15 bis -26

Run 34965406382 bis 36229949899, je `gh run view <id> --attempt 1 --log` (kein Lauf hatte einen
zweiten Versuch). Alle 100 liefen auf dem GitHub-gehosteten Image `ubuntu-24.04`. Gezählt wurde
je Lauf die letzte `##[group]…nx run`-Gruppe; zwei unabhängige Auswertungen (Python und das
awk-Kommando unten) ergeben dieselben Zahlen.

| Befund                                                                         | Anzahl |
| ------------------------------------------------------------------------------ | -----: |
| Läufe (50 PR, 50 main-Push)                                                    |    100 |
| ohne Tasks („No tasks were run")                                               |     15 |
| abgebrochen („The operation was canceled")                                     |      1 |
| **auswertbar** (42 PR, 42 main-Push)                                           | **84** |
| **letzte Gruppe gekappt** — kein `##[endgroup]`, keine `Duration`, kein Nx-Fazit | **71** |
| davon api-edge:test                                                            |     71 |
| davon Gruppeninhalt 65 536 B (16 × 4 KiB)                                      |     65 |
| davon 69 632 B oder 73 728 B (17 oder 18 × 4 KiB)                              |      5 |
| davon 62 560 B (61 440 + 1 120)                                                |      1 |
| vollständig                                                                    |     13 |

Gruppeninhalt heißt: Bytes aller Zeilen nach der Kopfzeile der Gruppe, je Zeile mit
Zeilenumbruch, `^[` als ESC zurückübersetzt. Am Roh-Joblog der API (`gh api --allow-escape-sequences
repos/panary/panary-core/actions/jobs/<job-id>/logs`) gegengezählt: dieselben 65 536 B. Die
Vielfachen von 4 KiB sind die Handschrift der Pipe, nicht einer Nx-Grenze. Mehr als 16 Seiten
kommen vermutlich durch, wenn `tee` noch während des `write()` Seiten leert. Die Form 61 440 + Rest
entsteht, wenn die Kopfzeile der Gruppe beim großen `write()` noch in der Pipe liegt: Der Kernel
füllt dann nur deren Seite auf und danach die 15 freien (Herleitung in panary-cloud, siehe unten).

Ob die Gruppe durchkam, hing am Anlass:

| Anlass                            | gekappt | vollständig |
| --------------------------------- | ------: | ----------: |
| PR                                |      41 |           1 |
| main-Push mit Remote-Cache-Retry  |      30 |           0 |
| main-Push ohne Retry              |       0 |          12 |

Wo api-edge:test der letzte Task war, gilt das ausnahmslos: 41 von 41 PR-Läufen und 30 von 30
Retry-Pushes gekappt, 10 von 10 Pushes ohne Retry vollständig. Der eine vollständige PR-Lauf
endete mit `pos-client:build:production` und 6,8 KB — das passte in eine Füllung. In den zehn
vollständigen api-edge:test-Gruppen liegen zwischen der letzten Zeile und `##[endgroup]` 0,48 bis
1,00 s. Das passt dazu, dass Nx auf main-Pushes (Read-Write-Token) nach dem letzten Task noch in
den Remote-Cache schreibt; in der Zeit leert die Event-Loop die Warteschlange. PR-Läufe schreiben
nicht in den Cache, und nach dem Retry läuft Nx ganz ohne ihn — beide enden sofort.

Im Messfenster antwortete der Remote-Cache auf main-Pushes in 30 von 42 Fällen mit
`Misconfigured remote cache endpoint: Unexpected response status: 500 Internal Server Error`,
seit 2026-09-22 13:45Z in 18 von 18. Der Retry verdeckt das als Warnung. Das ist ein eigenes
Thema; hier erklärt es nur, warum auch die meisten main-Pushes gekappt waren.

## Nachgestellt unter Linux

Docker auf `linux/arm64` mit 4-KiB-Seiten, Node 22. Statt Nx lief ein Stub, der Nx' eigenen
Ausgabecode fährt (`dist/src/utils/output.js` aus nx 22.7.12): eine kleine Gruppe, dann
api-edge:test mit rund 200 KB, dann die Schlusszeile und `process.exit()`. Der Schritt stammt
wörtlich aus `ci.yml` — alt von `origin/main`, neu aus diesem Stand —, und seine Ausgabe wird wie
beim Runner über eine Pipe gelesen. Vollständig heißt: `Duration`, danach `::endgroup::` und die
Nx-Schlusszeile. Je Szenario 10 Läufe:

| Szenario                 | alt (`\| tee`)          | neu (Datei + `tail --pid`) |
| ------------------------ | ----------------------- | -------------------------- |
| Erfolg                   | 0/10 vollständig, Exit 0 | 10/10 vollständig, Exit 0  |
| Fehlschlag               | 0/10 vollständig, Exit 1 | 10/10 vollständig, Exit 1  |
| Cache-500, Retry Erfolg  | 0/10 vollständig, Exit 0 | 10/10 vollständig, Exit 0  |
| Cache-500, Retry Fehler  | 0/10 vollständig, Exit 1 | 10/10 vollständig, Exit 1  |

Identisch unter Ubuntu 24.04 (GNU coreutils 9.4, die Basis des Runner-Images) und Ubuntu 26.04
(uutils coreutils 0.8.0, dorthin wird `ubuntu-latest` wandern). Die Retry-Warnung erschien in
beiden Varianten in 10 von 10 Retry-Läufen. Im alten Schritt endete die Gruppe beim Fehlschlag
mitten in einer Zeile, direkt gefolgt vom Nx-Fehlerbanner — dasselbe Bild wie im CI-Log.

Auf dem Runner belegt im PR-Lauf [36234912620](https://github.com/panary/panary-core/actions/runs/36234912620)
(`ubuntu-24.04`, ohne Retry — vorher 41 von 41 solcher PR-Läufe gekappt): api-edge:test war der letzte
Task, die Gruppe umfasst 278 116 B, gut vier Pipe-Füllungen, und endet mit `Test Files 103 passed`,
`Duration`, `##[endgroup]` und „Successfully ran targets …".

Gegenprobe mit einem `tail`, das `--pid` nicht kennt: Dessen Fehlermeldung steht im Log, der
Exit-Code bleibt der von Nx (0 bzw. 1), der Retry greift weiter. Dann fehlt die Ausgabe, der
Gate-Befund nicht.

## Maßnahme: Nx schreibt in eine Datei

```bash
run_logged() {
  : > "$log"
  "$@" > "$log" 2>&1 &
  local pid=$!
  tail --pid="$pid" -n +1 -f "$log"
  wait "$pid"
}
log="$(mktemp)"
if run_logged run_affected; then
  exit 0
fi
```

- stdout und stderr von Nx zeigen auf eine Datei. Node schreibt synchron, `process.exit()`
  verliert nichts, und stdout und stderr stehen in der Reihenfolge, in der sie geschrieben wurden.
- `tail --pid` streamt die Datei live ins Log und endet mit dem Lauf. Es prüft den Prozess etwa
  jede Sekunde; der Schritt wird dadurch knapp eine Sekunde länger, beim Retry zweimal (in der
  Nachstellung 1,01 s gegen 0,05 s). Bricht der Job-Timeout (30 min) ab, steht alles bis dahin
  Geschriebene im Log.
- Den Exit-Code liefert `wait`. Der Remote-Cache-Retry läuft über denselben Weg; `: >` leert die
  Datei vorher, damit der erste Lauf nicht doppelt erscheint.
- `set -o pipefail` entfiel im Skript: Es gibt keine Pipe mehr, und die Runner-Shell für
  `shell: bash` (`bash -eo pipefail`) setzt es ohnehin.

**Verworfen:**

- _nx auf 23.2 oder neuer heben:_ die Upstream-Lösung, aber ein Major-Sprung mit `nx migrate`,
  also ein eigenes Vorhaben. Die Datei bleibt auch danach richtig, weil `output.drain()` stderr
  und kleine Reste unter der `highWaterMark` nicht abdeckt.
- _`pnpm patch` von nx 22.7.12:_ ein Dependency-Patch für ein Problem, das die Datei ohne Patch
  löst.
- _Weniger Ausgabe, etwa `silent: 'passed-only'` in `apps/api-edge/vitest.config.mts`:_ Die
  Gruppe war 200 bis 236 KB groß. Weniger Ausgabe verschiebt nur die Schwelle: Unter einer
  Füllung kommt alles durch (der PR-Lauf mit 6,8 KB oben), darüber hängt es am Timing, wie viel
  ankommt (im Messfenster 15 bis 18 Seiten). panary-cloud ist genau so schon einmal gescheitert:
  `passed-only` drückte die Ausgabe unter eine Füllung, mit dem Wachstum der Suite war der
  Schnitt zurück.
- _`| tee` weglassen:_ Der Runner liest ebenfalls über eine Pipe (siehe oben).

## Was nicht betroffen ist

- **Reihenfolge-Gate** (`nx test api-edge`, run-one): Nx streamt die Ausgabe eines einzelnen
  Tasks laufend, statt sie am Ende in einem Stück zu schreiben. 82 von 82 Läufen im Messfenster
  enden mit `Duration` und „Successfully ran target test for project api-edge". Der Schritt
  bleibt unverändert.
- **Format-Gate** (`nx format:check --all`) hat denselben Mechanismus: `format.js` schreibt die
  Dateiliste per `console.log` und ruft direkt danach `process.exit(1)`, und zwar direkt an der
  Runner-Pipe. Eine Liste über 64 KiB — gut tausend Pfade — käme bei Fehlschlag gekappt an; der
  Exit-Code trägt die Aussage trotzdem. Im Messfenster war das Gate nie rot. Siehe den
  Korrekturvermerk in [ADR 0022](../adr/0022-format-gate-ohne-base.md).
- **Skript-Gates:** `scripts/empty-test-targets.mjs` lässt `nx graph --file=<datei>` in eine Datei
  schreiben, die Publishable-Prüfung leitet `nx show projects` mit `>` in eine Datei. Das
  Reihenfolge-Gate liest `nx show projects --affected --json` per `$(…)`, also über eine Pipe —
  aber wenige KB in einem `write()`, weit unter einer Füllung.

## Ist der Log vollständig?

Die letzte Nx-Task-Gruppe eines Laufs ist vollständig, wenn `##[endgroup]` folgt; bei einem
`:test`-Target steht außerdem die `Duration`-Zeile darin. Seit #409 ist ein Fehlen ein neuer
Befund — vorher war es der Normalfall, sobald api-edge:test als letzter Task endete. Prüfen je
Lauf:

```bash
gh run view <run-id> --repo panary/panary-core --attempt <n> --log | awk '
  { line = $0; sub(/^[^\t]*\t[^\t]*\t[^Z]*Z ?/, "", line); gsub(/\^\[\[[0-9;]*m/, "", line) }
  g && line ~ /Duration/ { d = 1 }
  g && line ~ /##\[(endgroup|group|error)\]|^ NX / { e = (line ~ /##\[endgroup\]/); g = 0 }
  line ~ /##\[group\].* nx run / { g = 1; d = 0; e = 0; t = line; sub(/.* nx run /, "", t); sub(/ +\[.*/, "", t) }
  END {
    if (t == "") { print "keine Nx-Task-Gruppe (No tasks were run?)"; exit }
    print t ": " (e ? "vollständig" : "GEKAPPT, ohne ##[endgroup]") (t ~ /:test/ ? (d ? " (Duration da)" : " (ohne Duration)") : "") }'
```

`gh run view --log` zeigt ESC als `^[`, daher das `gsub`. Der Step-Name lautet in älteren Logs
durchgehend `UNKNOWN STEP` — gezählt wird deshalb an der Gruppe, nicht am Schritt. Das
Reihenfolge-Gate schreibt keine Gruppe, die letzte Gruppe eines Laufs gehört also immer zum
affected-Schritt.

Die Regel dahinter gilt über die CI hinaus: **Die Ausgabe eines Node-CLIs, das mit
`process.exit()` endet, nie durch eine Pipe lesen, wenn man ihren Schluss braucht** — weder
`| tee` noch `| tail` noch `| grep` noch `execSync`. In eine Datei schreiben und daraus lesen.

## Siehe auch

- [ADR 0022 — Format-Gate ohne `--base`](../adr/0022-format-gate-ohne-base.md) — derselbe
  Schnitt bei `format:check`
- [Die vier Target-Gates](nx-target-gates.md) — dieselbe Fehlerklasse „grün, aber nicht
  gemessen"
- panary-cloud: `docs/infrastructure/api-cloud-test-target-in-ci.md` — Herleitung mit dem
  Seitenmodell der Linux-Pipe und den Nachstellungen mit echter Toolchain
