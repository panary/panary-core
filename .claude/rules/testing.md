---
paths:
  - '**/*.spec.ts'
  - '**/vitest.config.*'
  - '**/vite.config.*'
  - '**/project.json'
---

# Tests und Spec-Isolation – Panary Core (Code-Style §10)

> Ausgelagert aus `code-style.md` (panary/panary-core#318, 2026-09-15). Abschnittsnummer unverändert, damit Verweise wie `§10.1` weiter gelten.

## 10. Spec-Isolation: Aufzeichnungsobjekte gehören in den Test, nicht in den `describe`-Scope

> 🚨 **Ein `let recorder` im `describe`-Scope, das `beforeEach` neu zuweist, verwandelt jeden
> Timeout in einen zweiten, inhaltlich falschen Fehler in einem anderen Test.**

Der Reflex ist verbreitet und sieht harmlos aus:

```ts
// FALSCH — der Mock schreibt in die AKTUELLE Bindung, nicht in die von damals
describe('X', () => {
  let calls: Call[]
  beforeEach(() => {
    calls = []
  })
  // … Mock pusht in `calls` …
})
```

**Warum das bricht:** Vitest bricht beim Timeout den **Test** ab, nicht die laufende
Promise-Kette. Die kommt später zurück und ruft ihre Mocks weiter auf — die schreiben in
`calls`, und `calls` zeigt inzwischen auf das Array des **nächsten** Tests. Der zählt einen
Aufruf zu viel und scheitert mit einer Meldung, die mit ihm nichts zu tun hat. Wer sie liest,
sucht den Fehler in der Produktionslogik; er sitzt in der Testisolation.

```ts
// RICHTIG — der Mock schliesst über DIESE Instanz; ein Nachzuegler schreibt in sein
// eigenes, totes Objekt und erreicht den naechsten Test nicht mehr
function createRecorder() {
  return { calls: [] as Call[], purgeCalled: false }
}

it('…', async () => {
  const rec = createRecorder()
  installMocks(rec)
  // …
})
```

**Ein `vi.fn()` im `describe`-Scope ist derselbe Fall.** Das ist die Form, in der das Muster in
core auftritt — `mock.calls` **ist** ein Aufzeichnungsarray, nur von Vitest geführt statt selbst
geschrieben. Ein `beforeEach`, das `findMock = vi.fn()` neu zuweist, lässt einen Nachzügler aus
Test 1 in das Handle von Test 2 schreiben, und dessen `mock.calls[0]` ist dann fremd. Wer
`mock.calls`/`mock.results` auswertet, legt das Handle deshalb **im Test** an.

**Herkunft: gemessen in panary-cloud, nicht hier.** Der Fall ist in
panary/panary-cloud#241 aufgeschlagen (Timeout in `storefront-publish.spec.ts` T1 → Folgefehler
`expected [...] to have a length of 1 but got 2` in T2), dort mit erzwungenem Timeout wortgleich
reproduziert und als Regressionstest festgehalten. Die Mechanik ist reine Vitest-Semantik und
gilt in core unverändert; die Regel steht hier, damit sie beim Schreiben neuer Specs gefunden
wird — nicht, weil core einen eigenen Vorfall hätte.

**Der Timeout ist nicht die Ursache.** Ihn hochzudrehen macht die Kaskade seltener, nicht
falsch — Schritt 1 ist immer der Recorder. **Kein pauschales `testTimeout`** in einer
`vitest.config.mts`: Das nähme allen anderen Specs die schnelle Fehlermeldung. Wo ein
Suite-Timeout wirklich nötig ist (`describe('X', { timeout: 30_000 }, …)`), gehört die
Begründung daneben — und zwar eine gemessene, nicht „ist manchmal langsam".

**Betroffen ist nur, wer eine abbrechbare async-Kette startet.** Eine Spec, deren Test synchron
durchläuft, hat keine Nachzügler — dort ist die geteilte Bindung folgenlos, aber auch nicht
billiger. Bei **neuen** Specs deshalb ausnahmslos je Test anlegen.

### 10.1 Geteilt ist nicht die Bindung, sondern die Ressource

Bei Specs mit externem Zustand — IndexedDB, Dateien, Ports — reicht es **nicht**, die Instanz je
Test anzulegen. Wandert nur die Bindung in den Test, während der **Name** der Ressource konstant
bleibt, greifen alle Tests weiter auf dasselbe Ding zu:

```ts
// ZU KURZ GESPRUNGEN — jeder Test oeffnet dieselbe Datenbank
const dbName = 'adapter-test-db'

// RICHTIG — eigene Datenbank je Test; ein Nachzuegler findet die des naechsten Tests nicht
let dbSeq = 0
async function openAdapter() {
  const dbName = `adapter-test-db-${++dbSeq}`
  const adapter = new IdbStorageAdapter()
  await adapter.open(dbName, SCHEMA)
  onTestFinished(() => adapter.close())
  return { adapter, dbName }
}
```

Ein Zähler statt Zufall oder Zeitstempel: Der Name bleibt über Läufe hinweg reproduzierbar. Der
eindeutige Name macht zugleich das `destroy()` im Setup überflüssig, das vorher die Reste des
vorherigen Tests wegräumen musste.

**Cleanup gehört ebenfalls an den Test — `onTestFinished`, nicht `afterEach`.** Der naheliegende
Rückfall ist eine Liste offener Ressourcen im `describe`-Scope, die `afterEach` leert. Das ist
genau die geteilte Bindung von oben, nur mit einem anderen Inhalt. `onTestFinished` registriert
den Abbau am laufenden Test und läuft auch, wenn der Test wirft.

**Bestand der `beforeEach`-Form (gemessen am 2026-08-14, 159 Spec-Dateien in `apps/` + `libs/`):
0 Treffer** — der Suchbefehl unten liefert nichts mehr.

🚨 **„0 Treffer" heisst nicht „isoliert".** Am 2026-09-13 lagen in `apps/api-edge/test/` **vier**
reihenfolgeabhängige Suiten (#301), und der Befehl sah **keine einzige** davon. Zwei Gründe, beide
strukturell:

- Er filtert auf `--include='*.spec.ts'`. Die Integrationstests heissen `*.test.ts` (die
  vitest-`include` deckt `{test,spec}` ab, der Suchbefehl nicht) — sie liegen komplett ausserhalb
  seines Blickfelds.
- Er sucht **Zuweisungen in `beforeEach`**. Die vier Fälle bauen ihren Zustand in `beforeAll` als
  **Datenbankzeile** auf; im Testkörper steht keine Zuweisung, die er finden könnte. Geteilt ist
  dort nicht die Bindung und auch nicht der Name, sondern die Zeile selbst.

Der Befehl bleibt nützlich für die Form, die er kennt. Als Entwarnung taugt er nicht — wogegen
die zweite Form steht, sagt §10.2. Präzedenzfälle:

| Spec                                                                                                               | Geteilt war                               | Umbau                                | PR   |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- | ------------------------------------ | ---- |
| `apps/api-edge/src/print-server/auth.middleware.spec.ts`                                                           | `findMock` (`vi.fn()`, also `mock.calls`) | `makeApp()` je Test                  | #199 |
| `libs/shared/offline-cache/src/lib/{cache-bootstrap,idb-storage.adapter,offline-cache.store,outbox.store}.spec.ts` | Instanz **und** DB-Name                   | Factory je Test + `onTestFinished`   | #201 |
| `libs/domains/tse/domain/src/lib/simulator.adapter.spec.ts`                                                        | `tse`-Instanz                             | `new` im Test                        | #201 |
| `apps/api-edge/test/services/{orders/orders,users/users,users/admin-access-health,tenants/tenants}.test.ts`        | die **DB-Zeile** aus `beforeAll`          | Datensatz je Test + `onTestFinished` | #301 |

**Die Mutationsprobe gehört zu jedem solchen Umbau** (der allgemeine Fall, jeder neue Test, steht
in §10.3). Ein Test, der nach dem Umstellen noch grün ist, kann grün sein, weil er nichts mehr
prüft — grün war er vorher ja auch. Also den
Produktionscode gezielt brechen und nachsehen, ob der zugehörige Test rot wird; danach
zurücksetzen und mit `git diff --exit-code` belegen, dass keine Spur bleibt. Gefahren wurde je
umgebauter Datei mindestens eine (#199: Lookup auf Klartext → Test 1 rot, Kandidaten-Filter
aufgeweicht → Tests 2+3 rot; #201: `wiped` konstant, Index-Range ignoriert, `clear` in
`replaceAll` entfernt, `nextAttemptAt` ignoriert, `signatureCounter` nicht erhöht — jede fing
genau ihren Test).

⚠️ **`--sequence.shuffle` beweist den Gewinn NICHT.** Reihenfolgeunabhängigkeit ist billig zu
prüfen (`vitest run --sequence.shuffle`) und war auch vor dem Umbau gegeben, weil das alte
`beforeEach` die geteilte DB jedes Mal löschte. Der Lauf taugt als Kontrolle, dass der Umbau
nichts zerbrochen hat — nicht als Nachweis der Isolation. Die kommt aus der Struktur: Was der
nächste Test nicht kennt, kann ein Nachzügler nicht verfälschen.

**Er mischt auch INNERHALB einer Datei.** Vitest dokumentiert `sequence.shuffle: true` als
„Should files **and tests** run in random order" — beide Unterschalter (`shuffle.files`,
`shuffle.tests`) gehen damit an. Wer ihn für einen reinen Datei-Schalter hält, sucht die Ursache
eines roten Laufs in der falschen Ebene: Alle vier Fälle aus #301 liegen innerhalb je einer
Datei, und `fileParallelism: false` schützt gegen sie nicht (es serialisiert nur, es sortiert
nicht).

Reproduzierbar:

```bash
for f in $(grep -rl beforeEach apps libs --include='*.spec.ts'); do
  perl -0ne 'while (/beforeEach\(\s*(?:async\s*)?\(\)\s*=>\s*\{(.*?)\n\s*\}\)/gs) {
    $b=$1; while ($b =~ /^\s*(\w+)\s*=\s*[^=]/gm) { print "$ARGV: $1\n" } }' "$f"
done | sort -u
```

Das Muster in der inneren Schleife ist bewusst weiter als das cloud-Gegenstück (`= []|false|{}`):
Es findet auch `vi.fn()`- und SUT-Zuweisungen. Enger gefasst meldet es in core null Treffer und
sieht wie Entwarnung aus.

### 10.2 Integrationstests gegen die geteilte Edge-SQLite

Alle Suiten unter `apps/api-edge/test/` laufen gegen **eine** Datenbankdatei
(`vitest.config.mts`, `test.env.SQLITE_PATH`) — Vitest kann `env` nicht je Datei setzen, deshalb
`fileParallelism: false`. Das ist die dritte Stufe von §10/§10.1: Geteilt ist weder die Bindung
noch der Name, sondern **die Zeile**.

**Die Regel lautet hier: jeder Test legt seine Zeilen selbst an und räumt sie per
`onTestFinished` ab.** Ein `beforeAll`, das den Datensatz erzeugt, den mehrere Tests nacheinander
patchen, macht die Testreihenfolge zum Teil der Annahme. Gemessen am 2026-09-13 (#301) betraf das
vier Suiten mit zusammen fünf roten Tests — alle aus demselben Muster:

| Suite                               | geteilte Zeile  | was kippte                                                                           |
| ----------------------------------- | --------------- | ------------------------------------------------------------------------------------ |
| `orders/orders.test.ts`             | eine Order      | „Snapshot unverändert" erwartet 4000 Cents — der Rabatt-Test hatte 2000 hinterlassen |
| `users/users.test.ts`               | ein POS-User    | der Erfolgsfall löscht `mustChangePosPin`, das der Fehlversuch-Test gesetzt erwartet |
| `users/admin-access-health.test.ts` | ein Owner-Konto | Test 2 archiviert genau das Konto, dessen Aktivsein Test 1 zählt                     |
| `tenants/tenants.test.ts`           | ein Tenant      | `get`/`patch` setzen den `create` des Nachbartests voraus                            |

**Was im `beforeAll` bleiben darf: Aufbau, den kein Test verändert.** In `orders.test.ts` sind das
Filiale und User — sie werden gelesen, nie gepatcht. Die Trennlinie ist nicht „vor dem Test
angelegt", sondern „wird im Test verändert".

**Die ID ist der Ressourcenname (§10.1) — und hier gehört `uuidv7()` hin, nicht der dort
empfohlene Zähler.** Die Test-DB ist eine Datei und überlebt den Lauf. Ein reproduzierbarer Name
kollidiert nach einem Abbruch mit dem Rest des vorherigen Laufs, und dieser Fehlschlag sieht aus
wie ein Produktionsbug. `uuidv7` ist zugleich das ID-Format des Produktivcodes.

**Baselines gehören in den Test.** Wo eine Suite relativ misst („ein Konto mehr als vorher"),
muss die Ausgangszahl **im** Test genommen werden. Eine im `beforeAll` gemessene Baseline gilt nur
so lange, wie kein Test davor an der Zählung dreht — genau die Annahme, die der Shuffle bricht.

**Das Gate.** Seit #301 läuft in der CI ein zusätzlicher Schritt
(`.github/workflows/ci.yml`, „Reihenfolge-Gate"): derselbe api-edge-Lauf mit
`--sequence.shuffle` und einem aus `github.sha` abgeleiteten Seed. Zwei Eigenschaften, ohne die
er still blind wäre — beide in [ADR 0038](../../docs/adr/0038-shuffle-gate-mit-commit-seed.md)
begründet:

- **`--skip-nx-cache`**, sonst beantwortet Nx den identischen Befehl beim Re-Run aus dem Cache.
- **Seed aus dem Commit**, nicht `Date.now()`: Ein Schritt, der beim Re-Run desselben Commits
  anders ausgeht, wird nach dem dritten Mal weggeklickt — dieselbe Gewöhnung wie `--force` bei
  `wt.sh done`.

Lokal vor dem PR:

```bash
pnpm nx test api-edge --skip-nx-cache -- --sequence.shuffle --sequence.seed=42
```

⚠️ Das Gate bleibt eine **Stichprobe**: Es prüft je Lauf eine Permutation. Grün heisst „unter
diesem Seed keine Kopplung", nicht „isoliert" — die Aussage aus §10.1 gilt unverändert. Es fängt
den Rückfall, nicht die Abwesenheit.

### 10.3 Jeder neue Test braucht einen Rot-Nachweis

> 🚨 **Ein Test, der nie rot war, ist eine Behauptung, kein Netz.** Grün sagt nur, dass er heute
> nicht scheitert — nicht, dass er scheitern _kann_.

**Geltung: jeder neu geschriebene Test** — neue Spec-Datei oder neuer `it` in einer bestehenden,
egal aus welchem Anlass. Die anlassgebundenen Pflichten bleiben stehen und sind Spezialfälle dieser
Regel: der Spec-Umbau (§10.1), das neue Gate und in panary-cloud die Abnahmeregel für Mongo-Fakes
(cloud-ADR 0042, dort schärfer: Tenant-Filter weg → rot).

Warum die Lücke real ist: In panary-cloud blieben zwei von fünf Mutationen grün, weil die
Zusicherungen `recorded[0]` prüften und damit die falsche Funktion trafen (cloud-ADR 0042); eine
Zeitzonen-Spec blieb mit dem Defekt **vollständig** grün, weil `process.env.TZ` zur Laufzeit nichts
bewirkt. Beide Male sah die Suite wie ein Netz aus. Für einen frischen Feature-Test forderte bis
panary/panary-core#359 keine Regel den Nachweis — gemessen am 2026-09-20 entstanden in 50 Commits
34 neue Spec-Dateien.

**Zwei zulässige Formen, die Wahl hat der Autor:**

| Form           | Rot, weil …                                   | beweist                                |
| -------------- | --------------------------------------------- | -------------------------------------- |
| Test-First     | das Feature noch fehlt (Test vor dem Code)    | der Test war **irgendwann** rot        |
| Mutationsprobe | eine Produktionszeile gezielt gebrochen wurde | der Test schützt **genau diese** Zeile |

**Die Formen sind nicht gleich stark — sonst wird die schwächere zur Standardwahl.** Test-First-Rot
kann auch ein fehlender Import, ein `is not a function` oder ein Kompilierfehler gewesen sein; das
beweist nichts über die Zusicherung. Es zählt deshalb nur mit der **richtigen Meldung**: Die
Zusicherung selbst schlägt fehl (`expected … to be …`), nicht der Aufbau davor.

🚨 **Für sicherheitsrelevante Zusicherungen ist die Mutationsprobe Pflicht**, Test-First reicht dort
nicht: Mandanten-Scope und Tenant-Filter, Guards (`authorize`, `multiTenancy`, Rollen- und
Rechteprüfung, Eigentums-Checks), Resolver-Strips sensitiver Felder. Dort ist die Frage nicht „war
der Test je rot", sondern „wird er rot, wenn **dieser** Filter fehlt".

**Ausnahmen — kein Nachweis nötig:**

- reine Typ- oder Schema-Snapshots (der Compiler bzw. das Schema ist das Netz),
- Tests, die ausschließlich einen Konstantenwert festschreiben, einschließlich eines reinen Getters
  ohne Logik,
- generierte Specs (`should create` eines Nx-Generators), solange sie unverändert sind.

Die Ausnahme gilt **je Test, nicht je Datei**: Sobald ein Test eine Verzweigung, Rechnung oder
Filterung prüft, gilt die Pflicht. Ein Negativfall („kein Rabatt → kein Feld") braucht keinen eigenen
Rot-Nachweis, er soll unter der Mutation grün bleiben — das ist im Gegenteil ein nützlicher
Nebenbefund der Probe.

**Nachweisform: die ROT-Liste im Log-Fragment** (`docs/log.d/`, gleicher Commit wie der Test). Ohne
Spur ist die Regel unprüfbar. Je Variante eine Angabe `<was gebrochen> → <n> rot`, danach der
Kontrolllauf nach dem Zurücksetzen:

```md
- **Update**: Mutationsprobe zu den neuen Specs: `toReceiptDiscounts` auf leer → 6 rot,
  Nachlass-Schleife im Renderer entfernt → 4 rot; Kontrolllauf 10/10 grün.
- **Update**: Test-First: 3 rot vor der Implementierung (`expected undefined to be 'PICKUP'`).
```

Vorlagen aus dem Bestand: [#228](../../docs/log.d/2026-08-14-228-beleg-nachlass.md) (zwei
Varianten, Negativfälle grün) und [#337](../../docs/log.d/2026-09-18-337-pull-apply-tenant-guard.md)
(fünf Varianten mit je eigener Rot-Zahl). **Eine Variante mit 0 rot ist ein Befund, kein
Streichkandidat:** Entweder trifft die Mutation nichts, oder der Test prüft nicht, was er vorgibt —
genau der `recorded[0]`-Fall. Sie bleibt in der Liste stehen, bis geklärt ist, welches von beiden.

**Ausführung — erst committen, dann brechen.** Die Probe läuft auf einem committeten Stand: Ein
`git checkout -- <datei>` zum Zurücksetzen löscht sonst den eigenen, noch uncommitteten Fix, und die
Folgeproben messen gegen den alten Code und sehen trotzdem vollständig aus (viermal passiert).
Zurücksetzen per `git checkout -- <datei>`, danach `git diff --exit-code` als Beleg, dass keine Spur
bleibt. Kein `git stash` dafür (Workbench-CLAUDE.md, Git-Disziplin).

⚠️ **Kein Gate kann das prüfen.** Ob ein Test je rot war, existiert nur im Moment des Laufs; kein
`*:gate`-Skript und kein Mutation-Testing-Werkzeug (Stryker o. ä.) ist konfiguriert (gemessen am
2026-09-20). Die Regel lebt vom Review und von der Spur im Log-Fragment, und sie gilt **ab
panary/panary-core#359 nach vorn** — der Bestand wird nicht nachträglich belegt.
