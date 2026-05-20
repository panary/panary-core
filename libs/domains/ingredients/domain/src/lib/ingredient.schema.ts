import { Static, StringEnum, Type } from '@feathersjs/typebox'
import { allergenSchema, dietaryTagSchema } from '@panary/allergens/domain'

export const INGREDIENT_STATUSES = ['ACTIVE', 'DRAFT', 'ARCHIVED'] as const
export const ingredientStatusSchema = StringEnum([...INGREDIENT_STATUSES])
export type IngredientStatus = (typeof INGREDIENT_STATUSES)[number]

/**
 * Versionsrelevante Felder. Siehe
 * `panary-cloud/.claude/rules/code-style.md` §9.8 für das Pattern. Drift
 * zwischen panary-core und panary-cloud ist nicht erlaubt — panary-cloud
 * reexportiert diese Konstante (nicht eigene Whitelist).
 */
export const INGREDIENT_VERSION_FIELDS = ['baseUnit', 'baseQuantity', 'conversionFactor'] as const
export type IngredientVersionField = (typeof INGREDIENT_VERSION_FIELDS)[number]

export const ingredientSchema = Type.Object(
  {
    _id: Type.String(),
    /** Optional, für Edge↔Cloud-Sync und Migration aus Legacy-Datenständen. */
    externalId: Type.Optional(Type.Union([Type.String({ format: 'uuid' }), Type.Null()])),
    name: Type.String({ minLength: 1, maxLength: 255 }),
    displayName: Type.Optional(Type.String({ maxLength: 255 })),
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    category: Type.Optional(Type.String({ maxLength: 120 })),
    /** Basiseinheit (`GRAM`, `MILLILITER`, `PIECE`). */
    baseUnit: Type.String({ minLength: 1, maxLength: 32 }),
    baseQuantity: Type.Optional(Type.Number({ default: 1 })),
    /** z. B. 25000 für 25-kg-Sack → 25 000 Gramm. */
    conversionFactor: Type.Optional(Type.Number()),
    /** Manuell gepflegte Allergen-Liste. Aggregiert mit SupplierProduct-Allergenen am Backend. */
    allergensManual: Type.Optional(Type.Array(allergenSchema)),
    /** Diät-Tags — manuell + (Phase 2.5) automatisch abgeleitet. */
    dietaryTags: Type.Optional(Type.Array(dietaryTagSchema)),
    /** Standard-Bezugsquelle, falls mehrere SupplierProducts verknüpft sind. */
    defaultSupplierProductId: Type.Optional(Type.String()),
    /**
     * Default-Verwendungsmenge — wird beim Hinzufügen dieser Zutat als
     * Referenz in ein Rezept oder Produkt als initiale `quantity`
     * vorausgefüllt (z. B. `0.5` kg Mehl pro Standard-Verwendung). Optional;
     * Fallback `1`. Einheit ist `baseUnit`. UI-Hilfe — nicht versionsrelevant.
     */
    defaultReferenceQuantity: Type.Optional(Type.Number({ minimum: 0 })),
    status: Type.Optional(ingredientStatusSchema),
    /** Versions-Counter (vom `trackVersion`-Hook gepflegt). */
    currentVersion: Type.Optional(Type.Number({ default: 1 })),
    /** Versions-Snapshots — wird vom `trackVersion`-Hook angehängt. */
    history: Type.Optional(Type.Array(Type.Any())),
    tenantId: Type.String(),
    locationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'Ingredient' },
)
export type Ingredient = Static<typeof ingredientSchema>

/**
 * Ingredient mit am Backend berechneten Aggregaten (read-only). `allergens`
 * = Set(allergensManual ∪ ⋃ SupplierProduct.allergens), `supplierProductCount`
 * = Anzahl ACTIVE-verknüpfter SupplierProducts. Wird vom Resolver gesetzt.
 */
export const ingredientWithComputedSchema = Type.Intersect([
  ingredientSchema,
  Type.Object({
    allergens: Type.Optional(Type.Array(allergenSchema)),
    supplierProductCount: Type.Optional(Type.Number()),
  }),
])
export type IngredientWithComputed = Static<typeof ingredientWithComputedSchema>
