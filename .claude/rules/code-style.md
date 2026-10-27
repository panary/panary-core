# Code-Style-Regeln – Panary Core

> §10 (Spec-Isolation, Rot-Nachweis je neuem Test §10.3, Test-Timeouts, Runner-Konfiguration) ist nach `testing.md` ausgelagert und lädt bei `*.spec.ts`, vitest-Configs und `project.json`; die Abschnittsnummer gilt weiter.

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
- **Import:** `@import 'tailwindcss' source(none);` ganz oben in der globalen Styles-Datei, dazu `@source`-Zeilen mit
  Dateimuster (`libs/domains/*/*/src/**/*.{html,ts}`). Ohne `source(none)` walkt die automatische Suche `.nx/cache`
  und `nx serve` hängt (core#1138); ein Glob, der auf ein Verzeichnis endet, findet still nichts. In SCSS als
  Plain-CSS-`@import` nach den `@use`-Regeln. `pnpm tailwind:gate` (CI) prüft beides:
  [Tailwind-Quellensuche](../../docs/infrastructure/tailwind-quellensuche.md).
- **Niemals:** `@tailwind base`, `@tailwind components`, `@tailwind utilities`.
- **Theme:** Konfiguration ausschließlich im `@theme`-Block via CSS-Variablen.
- **Custom Utilities:** `@utility`-Block verwenden.
- **🚫 Kein Punkt im Namen einer `[class.…]`-Bindung.** Angular trennt den Namen am Punkt:
  `[class.translate-y-[calc(100%-4.5rem)]]` bindet `translate-y-[calc(100%-4` — eine Klasse ohne
  CSS, still wirkungslos (core#572). Arbitrary Values mit Punkt per `[class]="cond ? 'a' : 'b'"`.

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

| Element                 | Vorgabe                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| Framework               | Angular Material + Tailwind CSS                                                                    |
| Touch-Targets (Buttons) | Min-Höhe 48px                                                                                      |
| Primärfarbe             | Mint mit Navy-Schrift: `bg-action` / `text-on-action` (Token `--primary`/`--on-primary`, ADR 0058) |
| Erfolg/Fehler           | Tokens `accent-*` (Mint/Grün) und `danger-*` aus `@panary/design-tokens`                           |
| Typografie              | Serifenlos, Tablet-optimiert                                                                       |
| Komplexe Interaktionen  | Angular Material Dialogs                                                                           |

### 9.1 Farbsystem der POS-Funktionstasten (Kasse)

Funktionstasten im Button-Board des Bestelldialogs (`order-dialog.component`) sind farbcodiert
nach **Wirkung**, nicht nach Kontext — umgesetzt über `PosButtonUiState.variant` und die
Klassen-Matrix in `functionButtonClasses()`:

| Variante  | Farbe | Wirkung                     | Beispiele                                   |
| --------- | ----- | --------------------------- | ------------------------------------------- |
| `cancel`  | Rot   | verwirft / bricht ab        | ABBRUCH, Lösch-Tasten, Kombination auflösen |
| `skip`    | Amber | lässt weg / überspringt     | ÜBERSPRINGEN, KEIN TISCH, KEIN PAGER        |
| `confirm` | Mint  | übernimmt / bestätigt       | Kombinieren                                 |
| — (weiß)  | Weiß  | Produkte — **nie** Funktion | Produktkacheln                              |

Regeln:

- **Kein Vollton:** getönte Fläche + farbiger 2-px-Rahmen (`confirm`: `accent-soft`/`accent-line`,
  `cancel`: `red-50`/`red-200`, `skip`: `amber-50`/`amber-200`) — vollflächige Farbbalken ziehen mehr
  Blick als das Raster. Vollton trägt nur die **Primärtaste** (Mint mit Navy-Schrift). Keine
  Inline-Styles (`backgroundColor`/`fontColor`) auf Funktionstasten.
- **Kachelmaß = Produktkachel:** Breite `var(--pnry-tile-min)` (an `.kasse` 9,5rem), Höhe
  `var(--pnry-tile-h)` (5,25rem), beides als Token, nie fest im Template. Bis core#1020
  12,5 × 6,5rem — auf der Sunmi passten so nur 3×4 Produkte. Icon über Text, linksbündig **vor** dem Raster, außerhalb des Scroll-Containers (beim Scrollen
  immer sichtbar). Layout der Kasse: ADR 0059.
- **Keine Nummern auf Funktionstasten** — Artikelnummern-Badges nur auf Produktkacheln.
- **Pressed-Zustand** nur für echte Toggles: kräftigere Tönung + dunklerer Rahmen +
  `aria-pressed`. One-Shot-Tasten (ÜBERSPRINGEN etc.) bekommen nur momentanes
  `active:`-Feedback. Der einzige Toggle war OHNE; er ist mit dem Anpassen-Panel entfallen
  (panary/panary-core#639, `docs/domains/pos-anpassen-panel.md`).

### 9.2 Kein Gedankenstrich in POS-Texten

In sichtbaren Texten des POS-Clients steht kein Em-Dash („—“): i18n-Werte aller Sprachen, App-Name,
Fenstertitel und fest verdrahtete Meldungen (Michael, 2026-10-26, panary/panary-core#1106). Ersetzt wird
nach Satzbau, nicht blind:

| Satzbau                                   | Ersatz                           | Beispiel                             |
| ----------------------------------------- | -------------------------------- | ------------------------------------ |
| zwei Aussagen                             | zwei Sätze mit Punkt             | „Offline. Profildaten konnten …“     |
| kurze Statuszeile + Handlungsaufforderung | Mittelpunkt „·“ oder Doppelpunkt | „Ausgestempelt · Tippen zum Kommen“  |
| Fehler + Grund                            | Doppelpunkt                      | „Druckfehler: {{reason}}“            |
| Leerwert                                  | Halbgeviertstrich „–“            | `{{ user.employeeNumber \|\| '–' }}` |

Kommentare sind nicht betroffen. `pnpm pos-gedankenstrich:gate` (CI) prüft i18n, `tauri.conf.json` und den
`<title>` der `index.html`. Fest verdrahtete Texte in `.ts`/`.html` misst es nicht, weil sie sich ohne
Parser nicht von Kommentaren trennen lassen. Dort gilt diese Regel allein. Admin- und Setup-Client sind
nicht erfasst.

---
