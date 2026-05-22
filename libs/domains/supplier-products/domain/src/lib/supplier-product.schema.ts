import { Static, StringEnum, Type } from '@feathersjs/typebox'
import { allergenSchema } from '@panary/allergens/domain'

export const SUPPLIER_PRODUCT_SOURCES = ['MANUAL', 'OFF', 'GS1'] as const
export const supplierProductSourceSchema = StringEnum([...SUPPLIER_PRODUCT_SOURCES])
export type SupplierProductSource = (typeof SUPPLIER_PRODUCT_SOURCES)[number]

export const SUPPLIER_PRODUCT_STATUSES = ['ACTIVE', 'DRAFT', 'ARCHIVED'] as const
export const supplierProductStatusSchema = StringEnum([...SUPPLIER_PRODUCT_STATUSES])
export type SupplierProductStatus = (typeof SUPPLIER_PRODUCT_STATUSES)[number]

export const supplierProductNutritionSchema = Type.Object(
  {
    /** kcal pro 100 g/ml. */
    kcal: Type.Optional(Type.Number({ minimum: 0 })),
    protein: Type.Optional(Type.Number({ minimum: 0 })),
    fat: Type.Optional(Type.Number({ minimum: 0 })),
    carbs: Type.Optional(Type.Number({ minimum: 0 })),
    sugar: Type.Optional(Type.Number({ minimum: 0 })),
    salt: Type.Optional(Type.Number({ minimum: 0 })),
  },
  { $id: 'SupplierProductNutrition' },
)
export type SupplierProductNutrition = Static<typeof supplierProductNutritionSchema>

export const supplierProductSchema = Type.Object(
  {
    _id: Type.String(),
    /** FK → Ingredient (Pflicht — jedes Lieferantenprodukt ist einer generischen Zutat zugeordnet). */
    ingredientId: Type.String({ maxLength: 64 }),
    /** FK → Supplier (optional, null = Eigenmarke / unbekannt). */
    supplierId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    /** EAN-8/12/13/14 — sparse unique pro Tenant. */
    gtin: Type.Optional(Type.String({ pattern: '^[0-9]{8,14}$' })),
    productName: Type.String({ minLength: 1, maxLength: 255 }),
    manufacturer: Type.Optional(Type.String({ maxLength: 200 })),
    brand: Type.Optional(Type.String({ maxLength: 200 })),
    /** Verpackungsgröße — z. B. 25 für 25-kg-Sack. */
    packageQuantity: Type.Number({ exclusiveMinimum: 0 }),
    /** Einheit (KILOGRAM, LITER, PIECE, …). */
    packageUnit: Type.String({ minLength: 1, maxLength: 32 }),
    /** Anzahl Einheiten pro Karton — z. B. 12 Flaschen pro Karton. */
    unitsPerPackage: Type.Optional(Type.Integer({ minimum: 1 })),
    pricePerPackage: Type.Optional(Type.Number({ minimum: 0 })),
    /** Berechnet: pricePerPackage / (packageQuantity * (unitsPerPackage ?? 1)). */
    pricePerBaseUnit: Type.Optional(Type.Number({ minimum: 0 })),
    /** Unverbindliche Preisempfehlung (UVP) aus OFF, falls vorhanden. */
    rrp: Type.Optional(Type.Number({ minimum: 0 })),
    currency: Type.Optional(Type.String({ default: 'EUR', maxLength: 8 })),
    imageUrl: Type.Optional(Type.String({ format: 'uri' })),
    allergens: Type.Optional(Type.Array(allergenSchema)),
    nutrition: Type.Optional(supplierProductNutritionSchema),
    source: supplierProductSourceSchema,
    /** Roher OFF-Payload bei `source = OFF`, sonst leer. Untyped per Definition. */
    sourceMeta: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    lastSyncedAt: Type.Optional(Type.String({ format: 'date-time' })),
    status: Type.Optional(supplierProductStatusSchema),
    tenantId: Type.String(),
    locationId: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    createdAt: Type.Optional(Type.String({ format: 'date-time' })),
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'SupplierProduct', additionalProperties: false },
)
export type SupplierProduct = Static<typeof supplierProductSchema>

/**
 * Vorschau-DTO aus dem OFF-Lookup — nicht-persistent. Wird vom Frontend
 * angezeigt, bevor der User die Verlinkung bestätigt und ein
 * `SupplierProduct`-Record entsteht.
 */
export const supplierProductPreviewSchema = Type.Object(
  {
    gtin: Type.String(),
    productName: Type.Optional(Type.String()),
    manufacturer: Type.Optional(Type.String()),
    brand: Type.Optional(Type.String()),
    imageUrl: Type.Optional(Type.String({ format: 'uri' })),
    allergens: Type.Optional(Type.Array(allergenSchema)),
    nutrition: Type.Optional(supplierProductNutritionSchema),
    packageQuantity: Type.Optional(Type.Number()),
    packageUnit: Type.Optional(Type.String()),
    rrp: Type.Optional(Type.Number()),
    /** Wenn der Tenant diese GTIN bereits einem Ingredient zugeordnet hat. */
    existingIngredientId: Type.Optional(Type.String()),
    source: supplierProductSourceSchema,
  },
  { $id: 'SupplierProductPreview' },
)
export type SupplierProductPreview = Static<typeof supplierProductPreviewSchema>
