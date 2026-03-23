# Security-Regeln – Panary Core

## 1. Grundsätze

- Kritische Befehle (`rm`, `git reset`, destruktive DB-Migrationen) immer mit Auswirkungsbeschreibung ankündigen.
- API-Keys, JWTs oder Passwörter niemals loggen oder committen.
- Sensitive Felder (`_id`, `tenantId`, `locationId`, `createdAt`, `password`) immer über `resolveData` schützen.
- `createdAt` ist unveränderlich — niemals überschreiben. `updatedAt` wird ausschließlich serverseitig gesetzt.
- Keine clientseitige ID-Generierung erlauben, außer wenn für Offline-Sync zwingend notwendig.

---

## 2. Multi-Tenancy-Architektur (3-Schichten-Modell)

Jede externe Anfrage durchläuft drei Sicherheitsschichten in dieser festen Reihenfolge:

```
REQUEST
  │
  ├─ 1. authenticate('jwt')        → Token validieren, context.params.user befüllen
  ├─ 2. authorize()                → RBAC: Darf diese Rolle die Aktion ausführen?
  ├─ 3. multiTenancy()             → Daten auf tenantId/locationId stempeln & filtern
  │     SERVICE EXECUTION
  ├─ 4. resolveExternal / Resolver → Sensitive Felder ausblenden (password, apikey)
  └─ 5. ensureTenantIsolation()    → Nachgelagerte Validierung jedes zurückgegebenen Datensatzes
```

**Pflicht:** Jeder neue Service muss diese drei Hooks in `around.all` registrieren.

```typescript
app.service(myPath).hooks({
  around: {
    all: [
      authenticate('jwt'),
      authorize(),
      multiTenancy({ isolateLocation: true, allowGlobalData: false }),
      schemaHooks.resolveExternal(myExternalResolver),
      schemaHooks.resolveResult(myResolver),
    ],
  },
})
```

---

## 3. Hook: `authorize()`

**Datei:** `apps/api-edge/src/hooks/authorize.hook.ts`

Implementiert Role-Based Access Control (RBAC) über die zentrale `RolePermissions`-Matrix.

### Ablauf

1. Interne Aufrufe (kein `context.params.provider`) werden ohne Prüfung durchgelassen.
2. Nicht authentifizierte Aufrufe werden mit `403 Forbidden` abgelehnt.
3. `PLATFORM_OWNER` hat vollständigen Bypass (Gott-Modus).
4. Feathers-Methode wird auf `AppAction` gemappt:
   - `find`, `get` → `AppAction.READ`
   - `create` → `AppAction.CREATE`
   - `update`, `patch` → `AppAction.UPDATE`
   - `remove` → `AppAction.DELETE`
5. Prüfung: `RolePermissions[user.role]` enthält eine passende `{ resource, action }`-Regel?
6. Kein Treffer → `403 Forbidden` mit `AppError.AUTH_NO_PERMISSION`.

### Ressource = Service-Pfad

`context.path` (z. B. `'users'`, `'products'`, `'orders'`) wird als `AppResource` verwendet.

---

## 4. Hook: `multiTenancy(options)`

**Datei:** `apps/api-edge/src/hooks/multi-tenancy.hook.ts`

### Optionen

| Option | Typ | Beschreibung |
|---|---|---|
| `isolateLocation` | `boolean` | Filiale-Level-Isolation aktivieren |
| `allowGlobalData` | `boolean` | Globale Datensätze (`locationId: null`) sichtbar machen |

### Verhalten

**WRITE-Operationen** (`create`, `update`, `patch`) — Stamping:
- `data.tenantId = user.tenantId` wird erzwungen (nicht überschreibbar).
- Bei `isolateLocation: true`: `data.locationId = user.locationId` wenn nicht explizit gesetzt.

**READ-Operationen** (`find`, `get`, `remove`) — Scoping:
- `query.tenantId = user.tenantId` wird immer gesetzt (harter Filter auf DB-Ebene).
- Bei `isolateLocation: true`:
  - `TENANT_OWNER`, `TENANT_MANAGER` → kein Location-Filter (sehen alle Filialen).
  - Alle anderen Rollen → nur eigene Filiale; bei `allowGlobalData: true` zusätzlich `locationId: null`.

**Bypasses:**
- Kein User (interne Aufrufe) → kein Filter.
- Rollen mit Prefix `platform:` → vollständiger Bypass.

---

## 5. Hook: `ensureTenantIsolation()`

**Datei:** `apps/api-edge/src/hooks/ensure-tenant-isolation.hook.ts`

After-Hook auf App-Ebene (registriert in `app.ts`) — prüft nach jeder Service-Ausführung, ob zurückgegebene Datensätze zum Tenant des Nutzers gehören.

```typescript
// app.ts
app.hooks({
  after: { all: [ensureTenantIsolation()] },
})
```

Bei Mismatch: `console.error` Security-Alert + `403 Forbidden`. Verhindert Datenlecks auch bei fehlerhafter Query-Konfiguration.

---

## 6. UserSystemRole-Enum

**Datei:** `libs/domains/users/domain/src/lib/user.schema.ts`

```typescript
enum UserSystemRole {
  // Plattform-Ebene (Panary-intern)
  PLATFORM_OWNER   = 'platform:owner'   // Vollzugriff (Bypass aller Checks)
  PLATFORM_ADMIN   = 'platform:admin'   // DevOps/Entwickler
  PLATFORM_SUPPORT = 'platform:support' // Support-Mitarbeiter

  // Tenant-Ebene (Kunden)
  TENANT_OWNER   = 'tenant:owner'   // Inhaber
  TENANT_MANAGER = 'tenant:manager' // Filialleiter
  TENANT_STAFF   = 'tenant:staff'   // Kellner/Kassierer

  // Geräte-Rollen (Maschinen-User)
  DEVICE_POS    = 'device:pos'    // Stationäre Kasse
  DEVICE_KDS    = 'device:kds'    // Küchen-Monitor
  DEVICE_TABLET = 'device:tablet' // Mobiles Bestellgerät
  DEVICE_KIOSK  = 'device:kiosk'  // Selbstbedienungsterminal
}
```

Rollen mit Prefix `platform:` erhalten in `multiTenancy()` automatisch Bypass.
`PLATFORM_OWNER` erhält in `authorize()` automatisch Bypass.

---

## 7. RolePermissions-Matrix

**Datei:** `libs/domains/users/domain/src/lib/roles.matrix.ts`

Die Matrix ist die einzige Quelle der Wahrheit für RBAC-Berechtigungen.

| Rolle | Ressourcen & Aktionen |
|---|---|
| `PLATFORM_OWNER` | `system: MANAGE`, `users: MANAGE` |
| `PLATFORM_ADMIN` | `users: READ` |
| `PLATFORM_SUPPORT` | `users/orders/products/system: READ` |
| `TENANT_OWNER` | `users/products: MANAGE`, `orders: READ`, + Abilities: Reports, Refund |
| `TENANT_MANAGER` | `products: MANAGE`, `orders: CREATE+READ` |
| `TENANT_STAFF` | `products: READ`, `orders: CREATE+READ` |
| `DEVICE_POS` | `orders: MANAGE`, `products/users: READ`, `customers: READ+CREATE+UPDATE`, + Abilities: Clock-In, Discount, Refund |
| `DEVICE_KDS` | `orders: READ+UPDATE`, `products: READ` |
| `DEVICE_TABLET` | `orders: READ+CREATE+UPDATE`, `products/users: READ`, + Ability: Clock-In |
| `DEVICE_KIOSK` | `products: READ`, `orders: CREATE+READ` |

### AppAction-Mapping

| Wert | Bedeutung |
|---|---|
| `READ` | `find`, `get` |
| `CREATE` | `create` |
| `UPDATE` | `update`, `patch` |
| `DELETE` | `remove` |
| `MANAGE` | Alle Aktionen (überschreibt alle anderen) |

---

## 8. Resolver-Schutz (Sensitive Felder)

Sensitive Felder müssen über Feathers-Resolver geschützt werden — niemals über manuelle Filterung im Service.

### Pflicht-Resolver-Muster

**Externe Ausgabe** (`resolveExternal`):
- `password` → immer `undefined`
- `apikey` → nur bei `context.method === 'create'` zurückgeben, sonst `undefined`

**PATCH/UPDATE** (`resolveData`):
- `_id` → `undefined` (nicht veränderbar)
- `tenantId` → `undefined` (nicht veränderbar)
- `createdAt` → `undefined` (nicht veränderbar)
- `updatedAt` → `new Date().toISOString()` (serverseitig gesetzt)
- `password` → automatisch gehasht via `passwordHash({ strategy: 'local' })`

**Beispiel:**

```typescript
export const myPatchResolver = resolve<MyEntity, HookContext>({
  _id: async () => undefined,
  tenantId: async () => undefined,
  createdAt: async () => undefined,
  updatedAt: async () => new Date().toISOString(),
})
```

---

## 9. API-Key-Authentifizierung (Geräte)

- API-Keys sind Maschinen-Credentials pro Gerät (POS, KDS, Tablet, Kiosk).
- Werden mit `tenantId`, `locationId`, `deviceId` und einer Geräte-Rolle gespeichert.
- Werden **niemals nach der Erstellung** an den Client zurückgegeben (`resolveExternal`).
- Authentifizierungsstrategie: JWT (`@feathersjs/authentication` mit `JWTStrategy`).

---

## 10. Authentifizierungsstrategien

**Datei:** `apps/api-edge/src/authentication.ts`

| Strategie | Verwendung |
|---|---|
| `jwt` | Primäre Authentifizierung (stateless, Token-basiert) |
| `local` | E-Mail/Passwort-Login → generiert JWT |

---

## 11. Checkliste für neue Services

Vor dem Implementieren eines neuen Services prüfen:

- [ ] `authenticate('jwt')` in `around.all` registriert?
- [ ] `authorize()` in `around.all` registriert?
- [ ] `multiTenancy()` mit passenden Optionen in `around.all` registriert?
- [ ] `resolveExternal` schützt alle sensitiven Felder?
- [ ] `resolveData` (PATCH) verhindert Überschreiben von `_id`, `tenantId`, `createdAt`?
- [ ] Neue Ressource in `AppResource` definiert und in `RolePermissions`-Matrix eingetragen?
- [ ] Kein roher SQL/Mongo-Query im Service (nur Feathers Adapter API)?
