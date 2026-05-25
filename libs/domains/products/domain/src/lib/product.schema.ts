import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema, ingredientReferenceSchema, recipeReferenceSchema } from '@panary/shared-common'

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
  name: Type.String({ maxLength: 120 }), // Anzeigename in der Kasse/App (z.B. "Dips & Saucen")

  minSelections: Type.Integer({ default: 0, minimum: 0 }), // 0 = Optional (extra), 1 = Mandatory (menu step!)
  maxSelections: Type.Integer({ default: 1, minimum: 0 }), // 1 = radio buttons, >1 = checkboxes
  freeQuantity: Type.Integer({ default: 0, minimum: 0 }), // Replaces 'freeSaucesQuantity' (e.g., the first 2 are free)

  // Display type in the cash register
  uiMode: Type.Optional(StringEnum(['GRID', 'LIST', 'MODAL'])),

  // The actual options within this group
  options: Type.Array(
    Type.Object({
      productId: Type.String({ format: 'uuid' }), // Refers to a REAL product (e.g., "Cola")
      // Case A: Fixed price for this district (e.g., 3.00 €)
      priceOverride: Type.Optional(Type.Number({ minimum: 0 })),

      // Case B: Surcharge on the base price (e.g., +1.50 € for shrimp)
      priceAdjustment: Type.Optional(Type.Number()),
      isDefault: Type.Optional(Type.Boolean()), // Preselected?
    }),
    { maxItems: 100 },
  ),
})

// Availability
const availabilitySchema = Type.Object({
  isActive: Type.Boolean({ default: true }),
  mode: Type.Optional(StringEnum(['ALWAYS', 'SCHEDULED', 'OUT_OF_STOCK'])),
  stock: Type.Optional(Type.Number({ minimum: 0 })),
  scheduleRules: Type.Optional(
    Type.Array(
      Type.Object({
        days: Type.Array(Type.Number({ minimum: 0, maximum: 6 })), // 0=So, 1=Mo
        timeStart: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$' }),
        timeEnd: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$' }),
      }),
      { maxItems: 50 },
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
    name: Type.String({ maxLength: 200 }),
    icon: Type.Optional(Type.String({ maxLength: 8 })), // Emoji-Icon (nur UI, kein Druck)
    acronym: Type.String({ maxLength: 32 }), // Short name for kitchen receipt
    description: Type.Optional(Type.String({ maxLength: 2000 })),
    status: Type.Optional(StringEnum(['ACTIVE', 'DRAFT', 'ARCHIVED'])),

    // 2. Categorization (Dynamic!)
    // Simply link the product to one or more category IDs.
    categoryIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 50 }),

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
    price: Type.Number({ minimum: 0 }),
    taxInside: Type.Number({ minimum: 0, maximum: 100 }),
    taxOutside: Type.Number({ minimum: 0, maximum: 100 }),
    bundlePricingMode: Type.Optional(
      StringEnum([
        'ROLLUP', // Method 1: Price = sum of selected options (priceOverrides)
        'FIXED_PROPORTIONAL', // Method 2: Price = Fixed menu price, divided according to normal prices
      ]),
    ),
    // Normalpreis des Hauptgerichts eines FIXED_PROPORTIONAL-Bundles (z.B. der
    // Hamburger separat 4,40 €). Dient als Gewicht der Marktwert-Verteilung des
    // Festpreises (`price`) über die Steuersätze. Fehlt der Wert, trägt der Order-
    // Writer den Restbetrag (Festpreis − Σ Komponenten) als Hauptgewicht ein.
    mainPrice: Type.Optional(Type.Number({ minimum: 0 })),

    // 4. Customization & Menu Structure
    optionGroups: Type.Optional(Type.Array(optionGroupSchema, { maxItems: 50 })),

    // 5. Availability
    availability: Type.Optional(availabilitySchema),

    // 6. UI & Display
    ui: Type.Optional(
      Type.Object({
        index: Type.Number(), // Sortierung
        colorBg: Type.Optional(Type.String({ maxLength: 32 })),
        colorText: Type.Optional(Type.String({ maxLength: 32 })),
        showOptionsAuto: Type.Boolean({ default: false }), // Ersetzt showExtrasAfterSelect
        hideOnMainScreen: Type.Boolean({ default: false }), // Für Modifier, die nur IN Menüs existieren
      }),
    ),

    // 7. merchandise management
    isInvalid: Type.Optional(Type.Boolean()),
    productionTime: Type.Optional(Type.Number({ minimum: 0 })),
    ingredientReferences: Type.Optional(Type.Array(ingredientReferenceSchema, { maxItems: 200 })),
    recipeReferences: Type.Optional(Type.Array(recipeReferenceSchema, { maxItems: 200 })),
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
        'icon',
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
        'ingredientReferences',
        'recipeReferences',
      ]),
    ),
    // Pflicht fuer Sync-Bootstrap (Edge→Cloud): Edge-Records bringen `_id`,
    // `createdAt`, `updatedAt` mit. Ohne diese Felder im Schema lehnt
    // validateData den ganzen Record ab.
    Type.Partial(Type.Pick(productSchema, ['_id', 'createdAt', 'updatedAt'])),
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
// `updatedAt` ist Pflicht fuer Sync-Pull (Cloud→Edge): Filtern nach
// `updatedAt > since` und Sortieren — auch fuer Admin-UI sinnvoll.
export const productQueryProperties = Type.Pick(productSchema, ['_id', 'locationId', 'tenantId', 'externalId', 'status', 'name', 'productType', 'categoryIds', 'acronym', 'price', 'updatedAt'])
export const productQuerySchema = Type.Intersect(
  [
    // $regex-Opt-in fuer die globale Such-Leiste (case-insensitive Substring
    // ueber Name/Akronym/externe ID) — gilt auch innerhalb von `$or`.
    querySyntax(productQueryProperties, {
      name: { $regex: Type.String() },
      acronym: { $regex: Type.String() },
      externalId: { $regex: Type.String() },
    }),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type ProductQuery = Static<typeof productQuerySchema>
//#endregion
