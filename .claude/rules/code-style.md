# Code-Style-Regeln – Panary Core

## 1. Formatter (Prettier)

Einheitliche Einstellungen für alle Projekte im Workspace:

| Option | Wert |
|---|---|
| Anführungszeichen | Nur einfache (`'`) |
| Semikolon | Keines |
| Einrückung | 2 Leerzeichen |
| Zeilenlänge | Max. 120 Zeichen |
| Arrow-Parens | Nur wenn notwendig |

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

| Artefakt | Konvention | Beispiel |
|---|---|---|
| Dateinamen | `kebab-case` | `user-profile.component.ts` |
| Klassen / Interfaces | `PascalCase` | `UserProfileComponent` |
| Variablen / Funktionen | `camelCase` | `getUserById()` |
| Konstanten | `SCREAMING_SNAKE_CASE` | `MAX_RETRY_COUNT` |
| Enum-Member | `SCREAMING_SNAKE_CASE` | `UserSystemRole.TENANT_OWNER` |
| CSS-Klassen | `kebab-case` (Tailwind) | `text-primary-500` |

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
@import "../node_modules/tailwindcss";

@theme {
  --color-primary: oklch(55% 0.2 250);
  --font-display: "Satoshi", sans-serif;
}

@utility text-shadow-sm {
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
}
```

---

## 9. Design-System (POS-Kontext)

Zielgerät: Sunmi D3 Tablet (Touch-First).

| Element | Vorgabe |
|---|---|
| Framework | Angular Material + Tailwind CSS |
| Touch-Targets (Buttons) | Min-Höhe 48px |
| Primärfarbe | CSS-Variable `--color-primary` (Panary Blue) |
| Erfolg/Fehler | Semantisch: `--color-success`, `--color-error` |
| Typografie | Serifenlos, Tablet-optimiert |
| Komplexe Interaktionen | Angular Material Dialogs |
