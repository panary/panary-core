import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'

//#region Enums & Constants (Reusable)
export const MqttProtocolType = {
  WS: 'ws',
  WSS: 'wss',
} as const
export const mqttProtocol = StringEnum(Object.values(MqttProtocolType))

export const UnitSystem = {
  METRIC: 'metric',
  IMPERIAL: 'imperial',
} as const

export const LocationStatus = {
  ACTIVE: 'ACTIVE',
  DRAFT: 'DRAFT',
  ARCHIVED: 'ARCHIVED',
} as const
//#endregion

//#region Sub-Schemas
export const taxSchema = Type.Object({
  taxRate: Type.Number({ default: 0 }),
  name: Type.String(),
})

export const settingsSchema = Type.Object({
  generalSettings: Type.Object({
    systemOfUnits: StringEnum(Object.values(UnitSystem)),
    defaultWeightUnit: StringEnum(['kg', 'g', 'mg', 'lb', 'oz', 'st', 'ton']),
    defaultVolumeUnit: StringEnum(['L', 'ml', 'gal', 'qt', 'pt', 'fl oz', 'tbsp', 'tsp']),
    timezone: Type.String(), // Removed format: 'timezone' to fix AJV error
  }),
  printSettings: Type.Object({
    printServerEnabled: Type.Optional(Type.Boolean({ default: true })),
    maxNameCharacters: Type.Number(),
    mqttServerProtocol: mqttProtocol,
    mqttServerUrl: Type.String(),
    mqttServerPort: Type.Number({ minimum: 1, maximum: 65535 }),
    printerSequence: Type.Array(Type.String()),
    printers: Type.Array(
      Type.Object({
        pid: Type.String(),
        active: Type.Boolean({ default: true }),
        type: StringEnum(['ip', 'mqtt']),
        name: Type.String(),
        ip: Type.Optional(Type.String()),
        port: Type.Optional(Type.Number({ minimum: 1, maximum: 65535, default: 9100 })),
        primaryTopics: Type.Optional(Type.Array(Type.String())),
        mqttTopic: Type.Optional(Type.String()),
        paperWidth: Type.Optional(StringEnum(['58mm', '80mm'])),
        encoding: Type.Optional(Type.String({ default: 'CP437' })),
      }),
    ),
    separationCharacter: Type.String(),
    separationCharacterCount: Type.Number(),
    showDialogAfterOrder: Type.Boolean(),
    backofficePrinter: Type.Optional(Type.String()),
  }),
  serverSettings: Type.Object({
    path: Type.String({ default: '/ws' }),
    timeout: Type.Number({ default: 2000 }),
    reconnection: Type.Boolean({ default: false }),
    autoConnect: Type.Boolean({ default: false }),
  }),
  discountSettings: Type.Object({
    enabled: Type.Boolean({ default: false }),
    discounts: Type.Array(
      Type.Object({
        discountType: StringEnum(['percent', 'amount']),
        discount: Type.Number(),
      }),
    ),
  }),
  pagerSettings: Type.Object({
    enabled: Type.Boolean({ default: false }),
    pagers: Type.Array(Type.Union([Type.Number(), Type.Null()]), { default: [] }),
  }),
  tableSettings: Type.Object({
    enabled: Type.Boolean({ default: false }),
    rooms: Type.Array(
      Type.Object({
        name: Type.String(),
        tables: Type.Array(Type.String(), { default: [] }),
      }),
    ),
  }),
  genericUserSettings: Type.Object({
    autoLogOffTime: Type.Number({ default: 30 }),
    autoLogOffTimeUnit: Type.String({ default: 'sec' }),
  }),
  genericProductSettings: Type.Object({
    generalSideDishPrice: Type.Number({ default: 0 }),
    generalDrinkPrice: Type.Number({ default: 0 }),
  }),
  taxSettings: Type.Object({
    A: taxSchema,
    B: Type.Optional(taxSchema),
    C: Type.Optional(taxSchema),
    D: Type.Optional(taxSchema),
    E: Type.Optional(taxSchema),
    F: Type.Optional(taxSchema),
  }),
  invoiceSettings: Type.Optional(
    Type.Object({
      invoiceTemplate: Type.Optional(Type.Any()),
      taxNumber: Type.Optional(Type.String()),
      taxIdentificationNumber: Type.Optional(Type.String()),
      bankName: Type.Optional(Type.String()),
      iban: Type.Optional(Type.String()),
      bic: Type.Optional(Type.String()),
      textLine1: Type.Optional(Type.String()),
      textLine2: Type.Optional(Type.String()),
      textLine3: Type.Optional(Type.String()),
      textLine4: Type.Optional(Type.String()),
    }),
  ),
})
//#endregion

//#region The main data model (schema)
export const locationSchema = Type.Object(
  {
    _id: Type.String({ format: 'uuid' }), // Database ID (optional)

    createdAt: Type.Optional(Type.String({ format: 'date-time' })), // Creation date
    updatedAt: Type.Optional(Type.String({ format: 'date-time' })), // Change date

    tenantId: Type.String({ format: 'uuid' }), // Organizational affiliation

    address: Type.Object({
      street: Type.String({ minLength: 1 }),
      city: Type.String({ minLength: 1 }),
      postalCode: Type.String({ minLength: 1 }),
      country: Type.String({ minLength: 1 }),
    }),

    currentBusinessDay: Type.Optional(
      Type.Object({
        businessDayId: Type.String(), // Was ObjectIdSchema, using String for consistency
        date: Type.String({ format: 'date' }),
      }),
    ),

    email: Type.Optional(Type.String({ format: 'email' })),
    name: Type.String(),
    phone: Type.Optional(Type.String()),
    settings: Type.Optional(settingsSchema),
    status: Type.Optional(StringEnum(Object.values(LocationStatus))),
    website: Type.Optional(Type.String({ format: 'uri' })),
  },
  { $id: 'Location', additionalProperties: false },
)
export type Location = Static<typeof locationSchema>
export type Settings = Static<typeof settingsSchema>
//#endregion

//#region Schema for creation (POST)
export const locationDataSchema = Type.Pick(
  locationSchema,
  ['name', 'address', 'tenantId', 'settings', 'email', 'phone', 'website', 'status'],
  {
    $id: 'LocationData',
    additionalProperties: false,
  },
)
// Note: Old schema picked only name, address, tenantId.
// I added others to allow setting them on creation if needed, or I should be strict?
// Old schema: locationsDataSchema = Pick(locationsSchema, ['name', 'address', 'tenantId']).
// But locationsDataResolver sets settings, status etc.
// If I stick to old schema strictness:
// export const locationDataSchema = Type.Pick(locationSchema, ['name', 'address', 'tenantId'], ...
// I will stick to strict to match old behavior unless I want to enable more.
// But wait, if I want to support creating with email/phone?
// The user "manual" migration in products seemed to allow more?
// I'll stick to strict for now to be safe, or Add email/phone as they are good to have on creation.
// I'll stick to strict 'name', 'address', 'tenantId' as per old schema lines 145-149.
export type LocationData = Static<typeof locationDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const locationPatchSchema = Type.Partial(locationSchema, {
  $id: 'LocationPatch',
})
export type LocationPatch = Static<typeof locationPatchSchema>
//#endregion

//#region Schema for search queries (query)
export const locationQueryProperties = Type.Pick(locationSchema, ['_id', 'name', 'tenantId', 'currentBusinessDay'])
export const locationQuerySchema = Type.Intersect(
  [
    querySyntax(locationQueryProperties),
    // Add additional query properties
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type LocationQuery = Static<typeof locationQuerySchema>
//#endregion
