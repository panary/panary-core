# Logging-Regeln – Panary Core

## 1. Architektur: Wide Events / Canonical Log Lines

Das Backend verwendet **Wide Events** — pro externem Service-Call wird genau **eine strukturierte JSON-Logzeile** erzeugt, die alle relevanten Dimensionen enthält.

**Zentraler Hook:** `apps/api-edge/src/hooks/canonical-log.hook.ts`
- Registriert als äußerster `around.all`-Hook in `app.ts`
- Umschließt den gesamten Request-Lifecycle (inkl. Fehler)
- Interne Aufrufe (kein `provider`) werden nicht geloggt

**Logger:** `apps/api-edge/src/logger.ts` (Winston)
- **Production** (`NODE_ENV=production`): Strukturiertes JSON
- **Development** (default): Menschenlesbare Konsolenzeile

---

## 2. Wide Event Felder

Jedes Wide Event enthält automatisch:

| Feld | Quelle |
|---|---|
| `requestId` | uuidv7, generiert pro Request |
| `service`, `method`, `provider` | `HookContext` |
| `userId`, `userRole`, `tenantId`, `locationId`, `deviceId` | `context.params.user` |
| `status`, `statusCode` | Erfolg/Fehler |
| `duration_ms` | `performance.now()` Differenz |
| `resultCount` | Anzahl zurückgegebener Datensätze |
| `errorName`, `errorMessage`, `errorStack` | Nur bei Fehlern |
| `validationErrors`, `requestData` | Nur bei 400-Fehlern |
| `businessContext` | Service-spezifische Geschäftsdaten |

---

## 3. Business-Kontext

Der `canonicalLog`-Hook reichert automatisch `businessContext` an für:

| Service | Felder |
|---|---|
| `orders` | orderChannel, dineLocation, lineItemCount, grossAmount, paymentState, paymentMethod, dailySequenceNumber |
| `products` | productType, productStatus, price, availabilityMode, stockLevel |
| `users` (custom methods) | operation (clock-in/out, break-start/end) |
| `working-times` | checkinDate, checkoutDate, breakCount, businessDate |
| `order-interactions` | interactionType, orderId, deletedQuantity |

Neue Services können Enrichment hinzufügen in `enrichWithBusinessContext()` via `switch (context.path)`.

---

## 4. Regeln für neuen Logging-Code

- **Niemals `console.log/error/warn`** im Backend verwenden — ausschließlich `logger` aus `./logger`
- **Niemals sensitive Daten loggen:** `password`, `posPin`, `apikey`, `secret`, `token`, E-Mail, Telefonnummern, PII
- **Kein verstreutes Logging** in Service-Hooks — Fehler- und Request-Informationen gehören ins Wide Event
- **`logError`-Hook** loggt nur noch interne 5xx-Fehler (externe werden durch `canonicalLog` erfasst)
- **Strukturierte Objekte** an Logger übergeben: `logger.info({ message: '...', event: 'namespace.action', ...data })`
- **Event-Namenskonvention:** `namespace.action` (z.B. `db.indexes`, `device.auth`, `security.tenant_mismatch`)

---

## 5. Dev-Format (Konsolenausgabe)

Im Development-Modus zeigt der Logger eine kompakte, farbcodierte Zeile:

```
14:32:07 INFO  POST   /orders — 201 in 42ms
               ↳ order:pos/dine-in · seq:#245 · items:3 · total:28.50€ · payment:pending
14:32:08 WARN  POST   /orders — 400 in 5ms · BadRequest: validation failed
               ↳ /payment/state: must be equal to one of the allowed values
               ↳ order:telephone/take-out · items:2
14:32:09 INFO  GET    /health — 200 in 3ms
```

- Erste Zeile: Zeit, Level, HTTP-Verb, Pfad, Statuscode, Dauer, ggf. Fehler
- Rote ↳-Zeile: Validierungsfehler-Details (nur bei 400)
- Graue ↳-Zeile: Business-Kontext (nur wenn vorhanden)
