# Code-Style-Regeln – Panary Core

## 1. Formatter (Prettier)

Einheitliche Einstellungen für alle Projekte im Workspace:

| Option            | Wert               |
| ----------------- | ------------------ |
| Anführungszeichen | Nur einfache (`'`) |
| Semikolon         | Keines             |
| Einrückung        | 2 Leerzeichen      |
| Zeilenlänge       | Max. 120 Zeichen   |
| Arrow-Parens      | Nur wenn notwendig |

Code **außerhalb** des Änderungsbereichs nicht umformatieren — Git-Diffs minimal halten.

---

## 2. Allgemeine TypeScript-Konventionen

- **Typsicherheit:** Keine `any`-Typen ohne expliziten Kommentar. `unknown` bevorzugen.
- **Enums:** `const enum` oder `as const`-Objekte für externe Werte bevorzugen.
- **Generics:** Sprechende Namen verwenden (`TEntity` statt `T`).
- **Importe:** Absolute Pfade über `@panary/...`-Alias — keine relativen `../../../`-Importe über Bibliotheksgrenzen.
- **Exports:** Immer benannte Exports (`export const`, `export function`) — kein `export default`.

---

## 3. Kommentar-Konventionen

Kommentare hauptsächlich für das **Warum** komplexer Logik hinzufügen — nicht für das **Was**.

```typescript
// GUT: Erklärt das Warum
// TAX_RATE muss auf Nettobetrag angewendet werden, da Rabatte bereits abgezogen sind
const tax = netAmount * TAX_RATE

// SCHLECHT: Beschreibt nur das Was (offensichtlich)
// Multipliziere Betrag mit Steuersatz
const tax = netAmount * TAX_RATE
```

Instruction-Dateien (`.claude/`, `CLAUDE.md`, Kommentare in Rule-Files) immer auf **Deutsch** verfassen.

---

## 4. Dateistruktur-Konventionen

- **Schemata:** `libs/domains/[domain]/domain/src/lib/[entity].schema.ts`
- **Typen:** Über `Static<typeof schema>` aus TypeBox-Schema generieren.
- **Services:** `apps/api-edge/src/services/[name]/[name].ts`
- **Hooks (custom):** `apps/api-edge/src/hooks/[name].hook.ts`
- **UI-Komponenten:** `libs/` oder `apps/pos-client/src/app/features/[feature]/`

---

## 5. Benennung

| Artefakt               | Konvention              | Beispiel                      |
| ---------------------- | ----------------------- | ----------------------------- |
| Dateinamen             | `kebab-case`            | `user-profile.component.ts`   |
| Klassen / Interfaces   | `PascalCase`            | `UserProfileComponent`        |
| Variablen / Funktionen | `camelCase`             | `getUserById()`               |
| Konstanten             | `SCREAMING_SNAKE_CASE`  | `MAX_RETRY_COUNT`             |
| Enum-Member            | `SCREAMING_SNAKE_CASE`  | `UserSystemRole.TENANT_OWNER` |
| CSS-Klassen            | `kebab-case` (Tailwind) | `text-primary-500`            |

---

## 6. Feathers-spezifische Konventionen

- **Schemata:** TypeBox (`@feathersjs/typebox`) für alle Service-Schemas.
- **Keine rohen Writes in Services:** Niemals direkte SQL-Inserts/Updates/Deletes (Knex `.insert()`/`.update()`/`.delete()` auf der DB-Connection) oder Mongo-Writes (`insertOne`/`updateOne`/`deleteOne`/`bulkWrite`/…) im Service-Code. Schreib-Pfade laufen **ausschließlich** über die Feathers-Adapter-API (`service.create`/`service.patch`/`service.remove`) — auch bei internen Aufrufen mit `{ provider: undefined }`. Hintergrund: Validator-Hooks (`validateData`/`validatePatch`), `multiTenancy`-Stamping und Resolver-Schutz sind sonst umgangen.
- **Standard-Reads (`find`/`get` mit einfacher Query):** Über die Adapter-API (`service.find(...)`/`service.get(...)`) — nicht direkt auf der DB-Connection.
- **Komplexe Analytics-Reads** (Aggregationen, Joins, Window-Functions): Die Feathers-Adapter-API unterstützt sie nicht. Hier ist ein direkter DB-Call legitim, **aber nur** mit explizitem Tenant-Filter (`WHERE tenantId = ?` / `$match: { tenantId }`) als erstem Schritt. Bevorzugt: Helper-Wrapper bauen, der den Tenant-Scope erzwingt, statt jedem Call die Disziplin zu überlassen.
- **IDs:** `uuidv7` als String. Keine clientseitige ID-Generierung außer für Offline-Sync.
- **Daten:** ISO 8601-Strings (`YYYY-MM-DDTHH:mm:ss.SSSZ`) für alle Zeitstempel.

---

## 7. Angular-spezifische Konventionen

Ausführliche Regeln → siehe `angular.md`.

Kurzübersicht:

- Standalone-Komponenten (`standalone: true`), keine NgModules.
- `ChangeDetectionStrategy.OnPush` auf jeder Komponente.
- `inject()` für DI — kein Konstruktor-Injection.
- Signal-Inputs (`input()`, `input.required()`) statt `@Input()`.
- Block-Control-Flow (`@if`, `@for`, `@switch`) statt `*ngIf`, `*ngFor`.

---

## 8. Tailwind CSS v4 (Zero-Config)

- **Verboten:** Keine `tailwind.config.js` oder `tailwind.config.ts` erstellen.
- **Import:** `@import "tailwindcss";` ganz oben in der globalen Styles-Datei.
- **Niemals:** `@tailwind base`, `@tailwind components`, `@tailwind utilities`.
- **Theme:** Konfiguration ausschließlich im `@theme`-Block via CSS-Variablen.
- **Custom Utilities:** `@utility`-Block verwenden.

```css
/* styles.css */
@import '../node_modules/tailwindcss';

@theme {
  --color-primary: oklch(55% 0.2 250);
  --font-display: 'Satoshi', sans-serif;
}

@utility text-shadow-sm {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
```

---

## 9. Design-System (POS-Kontext)

Zielgerät: Sunmi D3 Tablet (Touch-First).

| Element                 | Vorgabe                                        |
| ----------------------- | ---------------------------------------------- |
| Framework               | Angular Material + Tailwind CSS                |
| Touch-Targets (Buttons) | Min-Höhe 48px                                  |
| Primärfarbe             | CSS-Variable `--color-primary` (Panary Blue)   |
| Erfolg/Fehler           | Semantisch: `--color-success`, `--color-error` |
| Typografie              | Serifenlos, Tablet-optimiert                   |
| Komplexe Interaktionen  | Angular Material Dialogs                       |

### 9.1 Farbsystem der POS-Funktionstasten (Bestelldialog)

Funktionstasten im Button-Board des Bestelldialogs (`order-dialog.component`) sind farbcodiert
nach **Wirkung**, nicht nach Kontext — umgesetzt über `PosButtonUiState.variant` und die
Klassen-Matrix in `functionButtonClasses()`:

| Variante  | Farbe | Wirkung                     | Beispiele                                   |
| --------- | ----- | --------------------------- | ------------------------------------------- |
| `cancel`  | Rot   | verwirft / bricht ab        | ABBRUCH, Lösch-Tasten, Kombination auflösen |
| `skip`    | Amber | lässt weg / überspringt     | OHNE, ÜBERSPRINGEN, KEIN TISCH, KEIN PAGER  |
| `confirm` | Teal  | übernimmt / bestätigt       | Alle Modifier anzeigen, Kombinieren         |
| — (weiß)  | Weiß  | Produkte — **nie** Funktion | Produktkacheln                              |

Regeln:

- **Kein Vollton:** getönte Fläche (`*-50`) + farbiger 2-px-Rahmen (`*-200`) — vollflächige
  Farbbalken ziehen mehr Blick als das Raster. Keine Inline-Styles (`backgroundColor`/`fontColor`)
  auf Funktionstasten.
- **Kachelmaß = Produktkachel:** Breite `var(--pnry-tile-min)` (8.25rem = 132 px), Höhe 5.375rem
  (86 px), Icon über Text, linksbündig **vor** dem Raster, außerhalb des Scroll-Containers
  (beim Scrollen immer sichtbar).
- **Keine Nummern auf Funktionstasten** — Artikelnummern-Badges nur auf Produktkacheln.
- **Pressed-Zustand** nur für echte Toggles (OHNE): kräftigere Tönung + dunklerer Rahmen +
  `aria-pressed`. One-Shot-Tasten (ÜBERSPRINGEN etc.) bekommen nur momentanes
  `active:`-Feedback.

---

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

**Bestand (gemessen am 2026-08-14, 159 Spec-Dateien in `apps/` + `libs/`):** Das klassische
Recorder-Array gibt es in core **nicht** — 0 Treffer. Sechs Specs weisen eine
`describe`-Scope-Bindung in `beforeEach` neu zu, überwiegend die Instanz des Systems under Test
(`libs/shared/offline-cache/*.spec.ts` mit `port`/`store`/`outbox`/`adapter`,
`libs/domains/tse/domain/src/lib/simulator.adapter.spec.ts` mit `tse`). Der einzige Treffer mit
Aufzeichnungscharakter ist `apps/api-edge/src/print-server/auth.middleware.spec.ts` (`findMock`,
drei async-Tests). Keiner davon ist mit dieser Regel umgebaut worden — sie greift für Neues.
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
