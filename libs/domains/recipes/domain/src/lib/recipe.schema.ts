import { Static, StringEnum, Type } from '@feathersjs/typebox'

/**
 * Item-Schema für die `ingredients`-Liste eines Rezepts.
 *
 * **Identifier-Strategie** (verbindlich):
 * - `externalId` ist der **stabile Anker** über Tenant-Grenzen, Export/Import
 *   und Edge↔Cloud-Sync. Wird vom Ingredient-Resolver per uuidv7 einmalig
 *   gesetzt und ändert sich nie.
 * - `ingredientId` (= MongoDB-`_id` der Zutat) ist Convenience für schnelle
 *   Lookups/Joins und kann sich theoretisch beim Tenant-Migrate ändern.
 *
 * Beide Felder sind im Item-Schema **optional**, aber mindestens eines muss
 * vorhanden sein. Der Backend-Resolver `resolveIngredientRefs` (im
 * `apps/api-cloud/.../recipes/`-Service) leitet das fehlende Feld per Lookup
 * automatisch ab — Frontend-Clients dürfen also je nach Kontext nur eines
 * der beiden setzen.
 *
 * `additionalProperties: true`, weil migrierte Records evtl. noch alte
 * Item-Felder mitbringen (z. B. `priceAdjustment`, `onlyOutsideConsumption`).
 * Saubere Records werden über die Resolver in das neue Format überführt.
 */
export const recipeIngredientItemSchema = Type.Object(
  {
    externalId: Type.Optional(Type.String({ format: 'uuid' })),
    ingredientId: Type.Optional(Type.String()),
    quantity: Type.Number({ minimum: 0 }),
    unit: Type.Optional(Type.String({ maxLength: 32 })),
  },
  { additionalProperties: true },
)
export type RecipeIngredientItem = Static<typeof recipeIngredientItemSchema>

export const recipeStatusSchema = StringEnum(['ACTIVE', 'DRAFT', 'ARCHIVED'])

/**
 * Kanonisches Recipe-Schema. Single Source of Truth — wird von panary-cloud
 * via Reexport konsumiert (`@panary/recipes/domain`). Edge-Sync und
 * Cloud-Service nutzen denselben Type.
 *
 * Versionsverwaltung über `currentVersion` + `history` (siehe
 * `RECIPE_VERSION_FIELDS`-Whitelist und `version-tracker.hook.ts`).
 *
 * **Entfernt** (Legacy-Cargo, 2026-05-09):
 * - `version` (Top-Level) — ersetzt durch `currentVersion` (Audit-Counter)
 * - `ingredientReferences` / `recipeReferences` (Top-Level) — auf Recipe-
 *   Ebene nicht modelliert; Verwendung passiert in Product → Recipe-Reference
 */
export const recipeSchema = Type.Object(
  {
    _id: Type.String(),
    tenantId: Type.String(),
    locationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),

    externalId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    displayName: Type.Optional(Type.String({ maxLength: 255 })),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    baseUnit: Type.String({ minLength: 1, maxLength: 32 }),
    baseQuantity: Type.Number({ default: 1, exclusiveMinimum: 0 }),

    /**
     * Default-Menge, die beim Hinzufügen dieses Rezepts als Reference in ein
     * Produkt vorausgefüllt wird (z. B. 0.25 kg Pizzateig pro Pizza). Optional
     * — fällt zurück auf `1`, wenn nicht gesetzt. Einheit ist `baseUnit`.
     * UI-Hilfe — nicht versionsrelevant.
     */
    defaultReferenceQuantity: Type.Optional(Type.Number({ minimum: 0 })),

    ingredients: Type.Array(recipeIngredientItemSchema, { maxItems: 200 }),
    status: Type.Optional(recipeStatusSchema),
    priceAdjustment: Type.Optional(Type.Number({ default: 0 })),

    // Versionierung — vom version-tracker.hook autoritativ gepflegt
    currentVersion: Type.Optional(Type.Number({ default: 1 })),
    history: Type.Optional(Type.Array(Type.Any(), { maxItems: 1000 })),
  },
  { $id: 'Recipe', additionalProperties: false },
)
export type Recipe = Static<typeof recipeSchema>

/**
 * Versionsrelevante Felder — Whitelist für `version-tracker.hook`.
 * `defaultReferenceQuantity` ist explizit NICHT enthalten (UI-Hilfsfeld).
 */
export const RECIPE_VERSION_FIELDS = [
  'baseUnit',
  'baseQuantity',
  'priceAdjustment',
  'ingredients',
] as const

export type RecipeVersionField = (typeof RECIPE_VERSION_FIELDS)[number]
