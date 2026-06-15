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

// Betriebsmodus pro Standort: Reines Bestellsystem ohne Kasse vs. volle Kasse.
// 'orders-only'   = Tagesabschluss aggregiert nur Bestellungen + Wareneinsatz; keine Kassenabstimmung, kein Z-Bon
// 'pos-cashier'   = Kassen-Compliance: Opening-Float, Cash-Count, Variance, lückenlose Z-Bon-Nummer
export const LocationOperationMode = {
  ORDERS_ONLY: 'orders-only',
  POS_CASHIER: 'pos-cashier',
} as const
//#endregion

//#region Sub-Schemas
export const taxSchema = Type.Object({
  taxRate: Type.Number({ default: 0, minimum: 0, maximum: 100 }),
  name: Type.String({ minLength: 1, maxLength: 60 }),
})

export const settingsSchema = Type.Object({
  generalSettings: Type.Object({
    systemOfUnits: StringEnum(Object.values(UnitSystem)),
    defaultWeightUnit: StringEnum(['kg', 'g', 'mg', 'lb', 'oz', 'st', 'ton']),
    defaultVolumeUnit: StringEnum(['L', 'ml', 'gal', 'qt', 'pt', 'fl oz', 'tbsp', 'tsp']),
    timezone: Type.String({ maxLength: 64 }), // Removed format: 'timezone' to fix AJV error
  }),
  printSettings: Type.Object({
    printServerEnabled: Type.Optional(Type.Boolean({ default: true })),
    maxNameCharacters: Type.Integer({ minimum: 1, maximum: 200 }),
    mqttServerProtocol: mqttProtocol,
    mqttServerUrl: Type.String(),
    mqttServerPort: Type.Number({ minimum: 1, maximum: 65535 }),
    printerSequence: Type.Array(Type.String()),
    printers: Type.Array(
      Type.Object({
        pid: Type.String(),
        active: Type.Boolean({ default: true }),
        type: StringEnum(['ip', 'mqtt']),
        name: Type.String({ minLength: 1, maxLength: 60 }),
        ip: Type.Optional(Type.String()),
        port: Type.Optional(Type.Number({ minimum: 1, maximum: 65535, default: 9100 })),
        primaryTopics: Type.Optional(Type.Array(Type.String())),
        mqttTopic: Type.Optional(Type.String()),
        paperWidth: Type.Optional(StringEnum(['58mm', '80mm'])),
        encoding: Type.Optional(Type.String({ default: 'CP437' })),
      }),
      { maxItems: 50 },
    ),
    separationCharacter: Type.String({ maxLength: 4 }),
    separationCharacterCount: Type.Integer({ minimum: 0, maximum: 200 }),
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
        discount: Type.Number({ minimum: 0 }),
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
        name: Type.String({ minLength: 1, maxLength: 80 }),
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
  openingHoursSettings: Type.Object({
    enabled: Type.Boolean({ default: false }),
    regular: Type.Array(
      Type.Object({
        day: Type.Number({ minimum: 0, maximum: 6 }), // 0=So, 1=Mo ... 6=Sa
        open: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$' }), // "HH:mm"
        close: Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$' }), // "HH:mm"
        closed: Type.Boolean({ default: false }),
      }),
    ),
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
  // Kassen-Einstellungen (Multi-Kassen-Tagesabschluss). Bewusst im settings-
  // JSON-Blob (wie alle anderen Location-Booleans) — Boolean reist als echtes
  // JSON-Boolean, keine SQLite-Boolean-Spalten-Coercion nötig.
  // Abhängigkeit: `autoOpenCashRegister` greift nur mit `defaultOpeningFloatCents > 0`
  // (Settings-UI erzwingt das; der Order-Guard fällt sonst auf den Manager-Dialog zurück).
  cashSessionSettings: Type.Optional(
    Type.Object({
      autoOpenCashRegister: Type.Optional(Type.Boolean({ default: false })),
      defaultOpeningFloatCents: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
    }),
  ),
  // Operative Beleg-/Bon-Einstellungen (ADR beleg-bon-system, D4). Live-patchbar
  // (kein Storefront-Republish). Das Fiskal-Gate bleibt allein an `operationMode` —
  // `tseEnabled` ist additiv und kann eine pos-cashier-Pflicht nie schwächen.
  // `consentNotice` als {de,en?} (LocalizedString-Form; in panary-core inline
  // gehalten, weil die LocalizedString-Lib cloud-seitig liegt).
  receiptSettings: Type.Optional(
    Type.Object({
      activeChannels: Type.Optional(Type.Array(StringEnum(['qr', 'nfc', 'email', 'wallet', 'print']), { default: ['qr'] })),
      defaultChannel: Type.Optional(StringEnum(['qr', 'nfc', 'email', 'wallet', 'print'])),
      localPrintOnly: Type.Optional(Type.Boolean({ default: false })),
      retentionDays: Type.Optional(Type.Integer({ minimum: 0 })),
      tseEnabled: Type.Optional(Type.Boolean()),
      printTarget: Type.Optional(Type.String({ maxLength: 120 })),
      // Reform-Readiness-Flags (ADR §9 / Phase 5) — config-getrieben, KEINE
      // hartkodierten Fristen/Schwellen. „digitale Belegpflicht ab 2029" wird so
      // eine reine Aktivierung ohne Datenmodell-Umbau. Enforcement folgt in der
      // Aktivierungs-Phase (z. B. localPrintOnly-only sperren, wenn digital Pflicht).
      digitalReceiptMandatory: Type.Optional(Type.Boolean()),
      cashRegisterMandatory: Type.Optional(Type.Boolean()),
      consentNotice: Type.Optional(
        Type.Object({
          de: Type.String({ maxLength: 500 }),
          en: Type.Optional(Type.String({ maxLength: 500 })),
        }),
      ),
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

    // Phase 6 BRAND-01 (D-03): FK auf brands._id.
    // Optional in v26.7.0 für Backward-Compat während Migration (BRAND-02);
    // Pflicht-Promotion erst in v27.0.0 / Phase 8 OPS Polish, nachdem
    // Migration alle Bestands-Locations einer Default-Brand zugeordnet hat.
    brandId: Type.Optional(Type.String({ description: 'uuidv7 — Phase 6 BRAND-01 (Pflicht nach Migration BRAND-02)' })),

    // Phase 6 BRAND-03 / D-14: URL-Slug für Subdomain-Routing
    // `<location-handle>.<brand-handle>.<panary-tld>` (z.B. mitte.burgerheaven.panary.cloud).
    // Unique pro brandId (D-18, Compound-Index brandId+handle). Default = slugifyHandle(name)
    // im Backfill (Plan 06-07). Optional in v26.7.0 für Migrations-Backward-Compat;
    // Promotion zu Pflicht in v27.0.0 (Phase 8 OPS Polish).
    handle: Type.Optional(
      Type.String({
        pattern: '^[a-z0-9-]+$',
        minLength: 1,
        maxLength: 64,
        description:
          'URL-Slug für Subdomain-Routing (BRAND-03 / D-14). Unique pro brandId. Optional in v26.7.0, Pflicht ab v27.0.0.',
      }),
    ),

    address: Type.Object({
      street: Type.String({ minLength: 1, maxLength: 200 }),
      city: Type.String({ minLength: 1, maxLength: 120 }),
      postalCode: Type.String({ minLength: 1, maxLength: 16 }),
      country: Type.String({ minLength: 1, maxLength: 80 }),
      // ISO-3166-1-alpha-2 (z.B. 'DE', 'AT', 'CH'). Normalisierte Form
      // neben dem Freitext-`country` — wird von der KI-Beleg-Extraktion
      // genutzt, um sprach-/MwSt-/Keyword-spezifisches Country-Pack zu
      // laden (`apps/api-cloud/src/lib/extraction-pipeline/country-packs/`).
      // Backwards-compat: Optional, Default 'DE' wird im Service-Resolver
      // gesetzt, damit Bestandskunden ohne Migration weiterarbeiten.
      countryCode: Type.Optional(Type.String({ pattern: '^[A-Z]{2}$' })),
    }),

    // Pointer auf den aktuell geoeffneten BusinessDay. Der closeDay-Flow patcht
    // dieses Feld explizit auf `null`, damit der Banner "Tag noch nicht
    // eroeffnet" sofort wieder erscheint. `Type.Optional` allein erlaubt nur
    // `undefined` — daher die Union mit `Type.Null()` zusaetzlich zum Optional.
    currentBusinessDay: Type.Optional(
      Type.Union([
        Type.Object({
          businessDayId: Type.String(),
          date: Type.String({ format: 'date' }),
        }),
        Type.Null(),
      ]),
    ),

    // Optional + akzeptiert leeren String. Hintergrund: AJV prueft `format` auf
    // jedem nicht-undefined-Wert; ein leerer String aus einem Form-Reset wuerde
    // sonst gegen "format: email" / "format: uri" abgewiesen. `Type.Optional`
    // selbst erlaubt nur `undefined`, daher die Union mit `Literal('')`.
    email: Type.Optional(Type.Union([Type.String({ format: 'email' }), Type.Literal('')])),
    name: Type.String({ minLength: 1, maxLength: 120 }),
    /**
     * @deprecated Phase 7 (Tenant-First-Class-Migration): Der Anzeige-Name
     * lebt jetzt am Tenant-Doc (`tenants.name` in panary-cloud). Dieses Feld
     * bleibt im Schema fuer Edge-Sync-Rueckwaertskompatibilitaet, wird aber
     * nicht mehr aktiv gepflegt. Wird in einer Folge-Migration komplett
     * entfernt, sobald alle Edge-Instanzen das neue Schema kennen.
     */
    organizationName: Type.Optional(Type.String({ maxLength: 200 })),
    phone: Type.Optional(Type.String({ maxLength: 32 })),
    settings: Type.Optional(settingsSchema),
    status: Type.Optional(StringEnum(Object.values(LocationStatus))),
    website: Type.Optional(Type.Union([Type.String({ format: 'uri' }), Type.Literal('')])),

    // BCP-47-Locale-Tag (z.B. 'de-DE', 'de-AT', 'de-CH'). Steuert die
    // Prompt-Sprache der KI-Beleg-Extraktion. Bewusst getrennt von
    // `address.countryCode`, weil eine Filiale in DE englischsprachige
    // Beleg-Erkennung wollen kann (englisches Personal). Default in
    // Service-Resolver: 'de-DE'.
    locale: Type.Optional(Type.String({ pattern: '^[a-z]{2}(-[A-Z]{2})?$' })),

    // Standard-Waehrung der Filiale als ISO-4217-Code (EUR, CHF, USD, …).
    // Bewusst Top-Level statt in `address`, weil DACH-Konzerne in DE-
    // Adressen mit CHF buchen koennen (Schweizer Mutter). Default in
    // Service-Resolver: 'EUR'.
    defaultCurrency: Type.Optional(Type.String({ pattern: '^[A-Z]{3}$' })),

    // Betriebsmodus: steuert Verhalten des Tagesabschlusses (Cash-Count vs
    // reiner Bestellaggregation) und welche UI-Steps angezeigt werden.
    // Optional + Service-Resolver-Default 'pos-cashier' für Bestandskunden.
    operationMode: Type.Optional(StringEnum(Object.values(LocationOperationMode))),

    // Letzter Arbeitstag der Woche (0=So…6=Sa, JS Date.getDay()-Konvention).
    // Steuert das Wochen-Highlighting in der Zeiterfassung — variiert je Land
    // (DE/AT/CH: 5=Fr, IL: 4=Do, viele Golf-Staaten: 4=Do). Top-Level statt im
    // Settings-Block, damit der Standort-Detail-Dialog das Feld direkt patchen
    // kann, ohne den vollen Settings-Tree mergen zu müssen (Konflikt-Risiko
    // mit parallelen Settings-Patches aus Drucker/Öffnungszeiten-Seiten).
    // Service-Resolver-Default: 5 (Freitag).
    lastWorkdayOfWeek: Type.Optional(Type.Integer({ minimum: 0, maximum: 6 })),
  },
  { $id: 'Location', additionalProperties: false },
)
export type Location = Static<typeof locationSchema>
export type Settings = Static<typeof settingsSchema>
//#endregion

//#region Schema for creation (POST)
export const locationDataSchema = Type.Pick(
  locationSchema,
  [
    'name',
    'address',
    'tenantId',
    'brandId',
    'handle',
    'settings',
    'email',
    'phone',
    'website',
    'status',
    'locale',
    'defaultCurrency',
    'operationMode',
    'lastWorkdayOfWeek',
  ],
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
// `brandId` + `handle` sind im Query-Whitelist, weil das Subdomain-Routing
// (`storefront-resolve` in panary-cloud) Locations ueber `{ brandId, handle }`
// aufloest und der Default-Brand-Lifecycle (ensure-location-handle / Migration
// 006) Bestands-Locations ueber `handle: { $exists: false }` diagnostiziert.
// Ohne sie lehnt `validateQuery` den Lookup mit "validation failed" ab.
export const locationQueryProperties = Type.Pick(locationSchema, [
  '_id',
  'name',
  'tenantId',
  'brandId',
  'handle',
  'currentBusinessDay',
  // Pflicht für den Offline-Cache-Delta-Sync (`updatedAt > cursor`) — sonst lehnt der
  // Query-Validator die Delta-Query mit 400 „additional property updatedAt" ab.
  'updatedAt',
])
// `$or` wird über Property-Spread an die `querySyntax`-Ausgabe gehängt — die
// Intersect-Variante mit zusätzlichem `Type.Object({$or})` produzierte unter
// TS 6.x ein "type instantiation is excessively deep" (TS2589) im
// `getValidator`-Konsumer. Flat-Object ist semantisch identisch und unter
// dem Tiefen-Limit. AJV validiert `$or`-Items ohnehin lose, daher `Type.Any()`.
const _locationQueryBase = querySyntax(locationQueryProperties)
export const locationQuerySchema = Type.Object(
  {
    ..._locationQueryBase.properties,
    $or: Type.Optional(Type.Array(Type.Any())),
  },
  { additionalProperties: false },
)
export type LocationQuery = Static<typeof locationQuerySchema>
//#endregion
