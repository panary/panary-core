import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema, recipeReferenceSchema } from '@panary-core/shared/common'

//#region Enums & Konstanten (Wiederverwendbar)
// TODO: Füge hier deine Enums und Konstanten hinzu
// Beispiel:
// export const ProductsStatus = {
//   ACTIVE: 'ACTIVE',
//   INACTIVE: 'INACTIVE',
// } as const
//#endregion

//#region Subschemas (Wiederverwendbar)
// Defines a group of choices (e.g., "Choose your drink," "Extras," "Cooking level")
const optionGroupSchema = Type.Object({
  id: Type.String({ format: 'uuid' }), // Interne ID für die Gruppe
  name: Type.String(), // Anzeigename in der Kasse/App (z.B. "Dips & Saucen")

  minSelections: Type.Number({ default: 0 }), // 0 = Optional (extra), 1 = Mandatory (menu step!)
  maxSelections: Type.Number({ default: 1 }), // 1 = radio buttons, >1 = checkboxes
  freeQuantity: Type.Number({ default: 0 }), // Replaces 'freeSaucesQuantity' (e.g., the first 2 are free)

  // Display type in the cash register
  uiMode: Type.Optional(StringEnum(['GRID', 'LIST', 'MODAL'])),

  // The actual options within this group
  options: Type.Array(
    Type.Object({
      productId: Type.String({ format: 'uuid' }), // Refers to a REAL product (e.g., "Cola")
      // Case A: Fixed price for this district (e.g., 3.00 €)
      priceOverride: Type.Optional(Type.Number()),

      // Case B: Surcharge on the base price (e.g., +1.50 € for shrimp)
      priceAdjustment: Type.Optional(Type.Number()),
      isDefault: Type.Optional(Type.Boolean()), // Preselected?
    }),
  ),
})

// Availability
const availabilitySchema = Type.Object({
  isActive: Type.Boolean({ default: true }),
  mode: Type.Optional(StringEnum(['ALWAYS', 'SCHEDULED', 'OUT_OF_STOCK'])),
  stock: Type.Optional(Type.Number()),
  scheduleRules: Type.Optional(
    Type.Array(
      Type.Object({
        days: Type.Array(Type.Number({ minimum: 0, maximum: 6 })), // 0=So, 1=Mo
        timeStart: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$' }),
        timeEnd: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$' }),
      }),
    ),
  ),
})
//#endregion

//#region Das Haupt-Datenmodell (Schema)
export const productSchema = Type.Object(
  {
    ...baseSchema,

    // 1. Identification
    externalId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]), // A UUID for technical system purposes (stable external ID)
    name: Type.String(),
    acronym: Type.String(), // Short name for kitchen receipt
    description: Type.Optional(Type.String()),
    status: Type.Optional(StringEnum(['ACTIVE', 'DRAFT', 'ARCHIVED'])),

    // 2. Categorization (Dynamic!)
    // Simply link the product to one or more category IDs.
    categoryIds: Type.Array(Type.String({ format: 'uuid' })),

    // Die Basis-Art des Produkts für die Logik
    productType: Type.Optional(
      StringEnum([
        'PRODUCT', // Completely normal retail product (cola, pizza)
        'BUNDLE', // Menu (consists primarily of option groups)
        'MODIFIER', // Ingredient (e.g., "without tomato," usually not sold separately)
        'SERVICE', // Service (no inventory, e.g., tips)
      ]),
    ),

    // 3.Price & Taxes
    price: Type.Number(),
    taxInside: Type.Number(),
    taxOutside: Type.Number(),
    bundlePricingMode: Type.Optional(
      StringEnum([
        'ROLLUP', // Method 1: Price = sum of selected options (priceOverrides)
        'FIXED_PROPORTIONAL', // Method 2: Price = Fixed menu price, divided according to normal prices
      ]),
    ),

    // 4. Customization & Menu Structure
    optionGroups: Type.Optional(Type.Array(optionGroupSchema)),

    // 5. Availability
    availability: Type.Optional(availabilitySchema),

    // 6. UI & Display
    ui: Type.Optional(
      Type.Object({
        index: Type.Number(), // Sortierung
        colorBg: Type.Optional(Type.String()),
        colorText: Type.Optional(Type.String()),
        showOptionsAuto: Type.Boolean({ default: false }), // Ersetzt showExtrasAfterSelect
        hideOnMainScreen: Type.Boolean({ default: false }), // Für Modifier, die nur IN Menüs existieren
      }),
    ),

    // 7. merchandise management
    isInvalid: Type.Optional(Type.Boolean()),
    productionTime: Type.Optional(Type.Number()),
    recipeReferences: Type.Optional(Type.Array(recipeReferenceSchema)),
  },
  { $id: 'Product', additionalProperties: false },
)
export type Product = Static<typeof productSchema>
//#endregion

//#region Schema for creation (POST)
// Pflichtfelder beim Create: name, acronym, price, taxInside, taxOutside, tenantId, locationId
// externalId, categoryIds und andere Felder haben Defaults oder werden serverseitig gesetzt
export const productDataSchema = Type.Intersect(
  [
    Type.Pick(productSchema, ['name', 'acronym', 'price', 'taxInside', 'taxOutside', 'tenantId', 'locationId']),
    Type.Partial(
      Type.Pick(productSchema, [
        'externalId',
        'description',
        'status',
        'categoryIds',
        'productType',
        'bundlePricingMode',
        'optionGroups',
        'availability',
        'ui',
        'isInvalid',
        'productionTime',
        'recipeReferences',
      ]),
    ),
  ],
  { $id: 'ProductData', additionalProperties: false },
)
export type ProductData = Static<typeof productDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const productPatchSchema = Type.Partial(productSchema, {
  $id: 'ProductPatch',
})
export type ProductPatch = Static<typeof productPatchSchema>
//#endregion

//#region Schema für Suchanfragen (Query)
export const productQueryProperties = Type.Pick(productSchema, ['_id', 'locationId', 'tenantId', 'externalId', 'status', 'name', 'productType', 'categoryIds', 'acronym', 'price'])
export const productQuerySchema = Type.Intersect(
  [
    querySyntax(productQueryProperties),
    // TODO: Füge zusätzliche Query-Properties hinzu
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type ProductQuery = Static<typeof productQuerySchema>
//#endregion
