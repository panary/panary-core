# Datenmodell-Regeln – Panary Core

---

## 1. Grundlegende Felder

| Feld | Typ | Regel |
|---|---|---|
| `_id` | `string` (uuidv7) | Immer `uuidv7`. Kein clientseitige Generierung, außer für Offline-Sync. |
| `tenantId` | `string` (uuidv7) | Pflicht auf allen mandantenfähigen Entitäten. Unveränderlich nach Erstellung. |
| `locationId` | `string \| null` | Optional. `null` = globale Daten (tenant-weit sichtbar). |
| `createdAt` | `string` (ISO 8601) | Unveränderlich. Serverseitig gesetzt. |
| `updatedAt` | `string` (ISO 8601) | Nur serverseitig aktualisiert (`resolveData`). |

**Datumsformat:** Immer `YYYY-MM-DDTHH:mm:ss.SSSZ` (ISO 8601 mit Millisekunden und Zeitzone).

---

## 2. Schema-Definition (TypeBox)

Schemata werden ausschließlich mit TypeBox (`@feathersjs/typebox`) definiert und in `libs/domains/` abgelegt.

```typescript
// libs/domains/[domain]/domain/src/lib/[entity].schema.ts
import { Type, Static } from '@feathersjs/typebox'

export const myEntitySchema = Type.Object({
  _id: Type.String(),
  tenantId: Type.String(),
  name: Type.String({ minLength: 1, maxLength: 120 }),
  createdAt: Type.String(),
  updatedAt: Type.String(),
})

// TypeScript-Typ automatisch ableiten
export type MyEntity = Static<typeof myEntitySchema>
```

**Regelung:**
- Schemata in `libs/domains/[domain]/domain/src/lib/[entity].schema.ts`.
- Niemals TypeScript-Interfaces manuell schreiben, wenn ein TypeBox-Schema existiert.
- `Static<typeof schema>` für alle abgeleiteten Typen verwenden.

---

## 3. "Product First"-Prinzip

Es gibt **keine separate `modifiers`-Tabelle**. Alles ist ein `product` mit einem `type`-Feld.

| Typ | Wert | Bedeutung |
|---|---|---|
| Standard-Artikel | `PRODUCT` | Reguläres Produkt |
| Extras/Zusätze | `MODIFIER` | Optionen, die einem Produkt hinzugefügt werden |
| Menüs/Bundles | `BUNDLE` | Zusammengestellte Produktgruppen |

### Bundle-Preisgestaltung (`bundlePricingMode`)

| Modus | Bedeutung |
|---|---|
| `ROLLUP` | Preis = Summe der Einzelpreise der enthaltenen Produkte |
| `FIXED_PROPORTIONAL` | Fixer Preis wird proportional auf Produkte aufgeteilt |

---

## 4. Domain-Bibliotheksstruktur

Business-Logik (Schemata, Typen, Utilities) lebt ausschließlich in `libs/domains/`.

```
libs/domains/
  [domain]/
    domain/
      src/
        lib/
          [entity].schema.ts    # TypeBox-Schema + exportierter Typ
          [entity].service.ts   # ggf. Business-Logik
          index.ts              # Public API der Bibliothek
      project.json
```

**Import-Pfad:** `@panary-core/[domain]/domain`

Apps (`api-edge`, `pos-client`) importieren aus Libs — niemals umgekehrt.

---

## 5. Schema-Änderungen → Migration erforderlich

Bei Änderungen an bestehenden Schemas:
- Prüfen, ob eine DB-Migration notwendig ist (SQLite via Knex).
- Neue Migration erstellen: `npm run db:create` im `panary-core/`-Verzeichnis.
- Anschließend: `npm run db:migrate`.

---

## 6. Validierung

- Schemas in `libs/domains/.../*.schema.ts` definieren.
- Validierung über Feathers `schemaHooks.validateQuery` / `schemaHooks.validateData` — niemals manuelle Validierung im Service-Code.
- Fehler werden automatisch als `400 Bad Request` zurückgegeben.
