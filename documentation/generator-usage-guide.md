---
title: Nx-Generator-Nutzungsanleitung
date: 2025-02-13
category: guide
domains: []
status: current
---

# FeathersJS Service Generator - Anleitung

## ✅ SO WIRD DER GENERATOR AUSGEFÜHRT

```bash
# Im panary-core Root-Verzeichnis
nx g ./tools/generators/feathers-service:feathers-service products
```

**Kurzform:**
```bash
nx g ./tools/generators/feathers-service:feathers-service <SERVICE_NAME>
```

---

## 📋 Beispiele

### 1. Einfacher Service (Standard)
```bash
nx g ./tools/generators/feathers-service:feathers-service products
```

**Erstellt:**
- ✅ Domain: `libs/domains/products/domain`
- ✅ Service: `apps/api-edge/src/services/products`
- ✅ Updates: `tsconfig.base.json`, `services/index.ts`

### 2. Mit anderem Projekt
```bash
nx g ./tools/generators/feathers-service:feathers-service orders --project=api-cloud
```

### 3. Ohne Domain Library
```bash
nx g ./tools/generators/feathers-service:feathers-service temp --skipDomain
```

### 4. Ohne baseSchema
```bash
nx g ./tools/generators/feathers-service:feathers-service custom --useBaseSchema=false
```

### 5. Mit Custom Display Name
```bash
nx g ./tools/generators/feathers-service:feathers-service products --displayName="Product Management"
```

### 6. Dry Run (Test ohne Änderungen)
```bash
nx g ./tools/generators/feathers-service:feathers-service products --dry-run
```

---

## 🎯 Output Beispiel

```bash
$ nx g ./tools/generators/feathers-service:feathers-service products

NX  Generating ./tools/generators/feathers-service:feathers-service

🚀 Starting FeathersJS Service Generator...

✅ Project validation passed: api-edge
📦 Creating service: products
   Project: api-edge
   Display Name: Products
   Use Base Schema: true
   Skip Domain: false

📁 Creating domain library...
✅ Domain library created at libs/domains/products/domain/src
✅ Updated tsconfig.base.json with @panary/products/domain path

📁 Creating service files...
✅ Service files created at apps/api-edge/src/services/products

📝 Registering service...
✅ Updated apps/api-edge/src/services/index.ts with products service registration

✨ Service generation completed!

📋 Next steps:
   1. Edit libs/domains/products/domain/src/lib/products.schema.ts
      → Add your custom fields to the schema
   2. Edit apps/api-edge/src/services/products/products.schema.ts
      → Implement custom resolvers (validation, business logic)
   3. Run: nx serve api-edge
   4. Test your service at: http://localhost:3030/products

CREATE libs/domains/products/domain/src/lib/products.schema.ts
CREATE libs/domains/products/domain/src/index.ts
CREATE apps/api-edge/src/services/products/products.class.ts
CREATE apps/api-edge/src/services/products/products.schema.ts
CREATE apps/api-edge/src/services/products/products.ts
UPDATE tsconfig.base.json
UPDATE apps/api-edge/src/services/index.ts
```

---

## 📂 Generierte Struktur

```
panary-core/
├── libs/domains/products/domain/
│   └── src/
│       ├── index.ts                              # ✅ Auto-generated
│       └── lib/
│           └── products.schema.ts                # ← TODO: Add fields
│
├── apps/api-edge/src/services/
│   ├── index.ts                                  # ✅ Auto-updated
│   └── products/
│       ├── products.class.ts                     # Service Interface
│       ├── products.schema.ts                    # ← TODO: Custom resolvers
│       └── products.ts                           # Service Registration + Hooks
│
└── tsconfig.base.json                            # ✅ Auto-updated
```

---

## ✏️ Nächste Schritte

### 1. Schema anpassen

**Datei:** `libs/domains/products/domain/src/lib/products.schema.ts`

```typescript
export const productsSchema = Type.Object({
  ...baseSchema,  // ✅ _id, timestamps, locationId, tenantId already included

  // TODO: Add your fields here
  name: Type.String(),
  sku: Type.String(),
  price: Type.Number(),
  category: StringEnum(['food', 'drink', 'merchandise']),
  description: Type.Optional(Type.String()),
  stock: Type.Number({ default: 0 }),
  active: Type.Boolean({ default: true }),
})
```

### 2. Custom Resolver (optional)

**Datei:** `apps/api-edge/src/services/products/products.schema.ts`

```typescript
export const productsDataResolver = resolve<Products, HookContext>({
  // ✅ Already implemented:
  _id: async (value) => value || new ObjectId().toHexString(),
  createdAt: async () => Date.now(),
  updatedAt: async () => Date.now(),

  // TODO: Add custom logic
  slug: async (value, product) => {
    return value || product.name.toLowerCase().replace(/\s+/g, '-')
  }
})
```

### 3. Service starten

```bash
nx serve api-edge
# → Service available at: http://localhost:3030/products
```

---

## ⚙️ Alle Parameter

| Parameter | Typ | Default | Beschreibung |
|-----------|-----|---------|--------------|
| `name` | string | - | **Required.** Service Name (z.B. 'products') |
| `project` | string | `api-edge` | Ziel-Projekt |
| `displayName` | string | Capitalized name | Display Name für Service |
| `skipDomain` | boolean | `false` | Domain Library überspringen |
| `useBaseSchema` | boolean | `true` | baseSchema verwenden |

---

## 🔥 Automatisch generiert

✅ **Domain Schema** mit:
- `_id: Type.String()`
- `createdAt: Type.Number()`
- `updatedAt: Type.Number()`
- `locationId: Type.String()`
- `tenantId: Type.String()`

✅ **Service Resolver** mit:
- ID Generation (`new ObjectId().toHexString()`)
- Timestamp Management (`Date.now()`)

✅ **Hooks**:
- Authentication (`authenticate('jwt')`)
- Authorization (`authorize()`)
- Multi-Tenancy (`multiTenancy()`)
- Schema Validation (TypeBox)

✅ **Factory Pattern**:
- SQLite (Edge/Core) → `KnexService`
- MongoDB (Cloud/Enterprise) → `MongoDBService`

---

## 🐛 Troubleshooting

### Fehler: "Cannot find project"

**Lösung:** Stelle sicher, dass du im Root-Verzeichnis bist:

```bash
pwd
# Sollte zeigen: .../panary-core

ls apps/
# Sollte zeigen: api-edge, pos-client, etc.
```

### Fehler: "services/index.ts not found"

**Lösung:** Das Projekt benötigt eine `src/services/index.ts`:

```bash
ls apps/api-edge/src/services/index.ts
```

### Generator nicht gefunden

**Lösung:** Prüfe Generator-Dateien:

```bash
ls tools/generators/feathers-service/
# Sollte zeigen: generator.ts, schema.json, package.json, generators.json, files/
```

### TypeScript Fehler nach Generierung

**Lösung:** TypeScript Server neu starten:
- **VS Code:** `Cmd+Shift+P` → "TypeScript: Restart TS Server"
- **WebStorm:** Rechtsklick → "Reload"

---

## 💡 Tipps

1. ✅ **Nutze --dry-run** zum Testen
2. ✅ **baseSchema** für konsistente Felder
3. ✅ **TODO-Marker** ausfüllen
4. ✅ **Timestamps als Number** (Millisekunden)
5. ✅ **Query Resolver** für Zugriffsbeschränkungen

---

## 📚 Weitere Dokumentation

- **Service Pattern:** `documentation/service-creation-guide.md`
- **Generator Details:** `tools/generators/feathers-service/README.md`
- **FeathersJS Docs:** https://feathersjs.com
