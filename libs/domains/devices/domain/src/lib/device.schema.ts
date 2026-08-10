import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

import { DeviceAccessMode, MAX_ASSIGNED_USER_IDS } from './device-access-mode'

//#region Enums & Constants (Reusable)
export const DeviceType = {
  POS_COUNTER: 'pos-counter',
  KDS: 'kds',
  TABLET: 'tablet',
  OTHER: 'other',
} as const

// Fluide UI-Skalierung (PNRY-FEAT-POS-UI-SCALE-001): Density-Stufen pro
// Terminal. Die Faktoren sind bewusst KEINE Enum-Magie — sie sind Defaults,
// die pro Geraet ueber `uiScale.factors` ueberschreibbar bleiben
// (Prinzip „Konfiguration statt Hardcoding").
export const UiDensity = {
  COMPACT: 'compact',
  DEFAULT: 'default',
  COMFORTABLE: 'comfortable',
  LARGE: 'large',
} as const
export type UiDensityLevel = (typeof UiDensity)[keyof typeof UiDensity]
export const DEFAULT_UI_DENSITY_FACTORS: Readonly<Record<UiDensityLevel, number>> = {
  compact: 0.9,
  default: 1,
  comfortable: 1.15,
  large: 1.3,
}
//#endregion

//#region The main data model (schema)
export const deviceSchema = Type.Object(
  {
    ...baseSchema,

    deviceId: Type.String({ format: 'uuid' }), // Unique device identifier (UUID), kept from old schema

    name: Type.String({ maxLength: 100 }),
    type: StringEnum(Object.values(DeviceType)),
    apiKeyId: Type.Optional(Type.String({ format: 'uuid' })),
    lastSeen: Type.Optional(Type.String({ format: 'date-time' })),
    active: Type.Boolean({ default: true }),
    metadata: Type.Optional(
      Type.Object({
        userAgent: Type.Optional(Type.String({ maxLength: 512 })),
        ipAddress: Type.Optional(Type.String({ maxLength: 45 })),
        version: Type.Optional(Type.String({ maxLength: 50 })),
      }),
    ),
    // Terminal-eigene UI-Skalierung (PNRY-FEAT-POS-UI-SCALE-001). Optional —
    // Geraete werden ohne uiScale angelegt; das Terminal schreibt es via
    // Self-Patch (siehe device-self-patch-policy.ts) zurueck. `factors` als
    // Partial-Record ueber die Density-Literale statt Type.Record+StringEnum:
    // StringEnum ist TUnsafe und kein gueltiger Record-Key (TS-Fehler,
    // Validierung wuerde zu patternProperties '^.*$' degradieren — beliebige
    // Keys). So bleiben nur echte Density-Keys erlaubt, jeder optional.
    uiScale: Type.Optional(
      Type.Object(
        {
          density: StringEnum(Object.values(UiDensity)),
          factors: Type.Optional(
            Type.Partial(
              Type.Record(
                Type.Union(Object.values(UiDensity).map(value => Type.Literal(value))),
                Type.Number({ minimum: 0.5, maximum: 2 }),
                { additionalProperties: false },
              ),
            ),
          ),
        },
        { additionalProperties: false },
      ),
    ),
    // Geraete-Zuweisung (PNRY-FEAT-DEVICE-ASSIGNMENT-001). BEIDE Felder
    // optional: Bestandsgeraete tragen sie nicht, und `additionalProperties:
    // false` verbietet nur Fremd-Keys, nicht das Fehlen. Regeln und Defaults in
    // device-access-mode.ts — hier steht bewusst KEIN `default`, damit
    // `undefined` als „shared" durch genau einen Helfer laeuft.
    deviceAccessMode: Type.Optional(StringEnum(Object.values(DeviceAccessMode))),
    assignedUserIds: Type.Optional(
      Type.Array(Type.String({ format: 'uuid' }), { maxItems: MAX_ASSIGNED_USER_IDS, uniqueItems: true }),
    ),
    createdBy: Type.String({ maxLength: 100 }),
  },
  { $id: 'Device', additionalProperties: false },
)
export type Device = Static<typeof deviceSchema>
//#endregion

//#region Schema for creation (POST)
export const deviceDataSchema = Type.Object(
  {
    name: Type.String({ maxLength: 100 }),
    type: StringEnum(Object.values(DeviceType)),
    // Optional, weil serverseitig von `multiTenancy()` gestempelt — als
    // Pflichtfeld waere die 400-Meldung bei fehlgeschlagenem Stempel
    // irrefuehrend (ADR 0031 in panary-cloud).
    locationId: Type.Optional(Type.String()),
    tenantId: Type.Optional(Type.String()),
    metadata: Type.Optional(
      Type.Object({
        userAgent: Type.Optional(Type.String({ maxLength: 512 })),
        ipAddress: Type.Optional(Type.String({ maxLength: 45 })),
        version: Type.Optional(Type.String({ maxLength: 50 })),
      }),
    ),
    apiKeyId: Type.Optional(Type.String({ format: 'uuid' })),
    active: Type.Optional(Type.Boolean({ default: true })),
    // Zwingend auch im POST-Schema: `validateData` laeuft auch bei
    // `provider: undefined`, und der Pairing-Redeem-Pfad legt die Zuweisung
    // bereits beim Create an. Fehlten die Felder hier, verwuerfe
    // `additionalProperties: false` sie mit einem 400.
    deviceAccessMode: Type.Optional(StringEnum(Object.values(DeviceAccessMode))),
    assignedUserIds: Type.Optional(
      Type.Array(Type.String({ format: 'uuid' }), { maxItems: MAX_ASSIGNED_USER_IDS, uniqueItems: true }),
    ),
  },
  { $id: 'DeviceData', additionalProperties: false },
)
// Old schema picked ONLY name, type, locationId, tenantId.
// But resolved deviceId, active, createdBy.
// So client sends name, type, locId, tenId.
// I'll stick to strict pick if I want to match old behavior exactly.
// But deviceDataSchema usually defines what client SENDS.
// Old schema: name, type, locationId, tenantId.
// I'll revert to that strict pick.
export type DeviceData = Static<typeof deviceDataSchema>
//#endregion

//#region Scheme for updates (PATCH)
export const devicePatchSchema = Type.Partial(deviceSchema, {
  $id: 'DevicePatch',
})
export type DevicePatch = Static<typeof devicePatchSchema>
//#endregion

//#region Schema for search queries (query)
// `assignedUserIds` fehlt hier bewusst: am Edge liegt die Liste als TEXT/JSON in
// SQLite — ein Gleichheitsvergleich waere still falsch (er vergliche den
// serialisierten String). Wer nach zugewiesenen Geraeten filtern will, nimmt
// `deviceAccessMode` und filtert die Liste in der Anwendung.
export const deviceQueryProperties = Type.Pick(deviceSchema, [
  '_id',
  'deviceId',
  'name',
  'type',
  'active',
  'locationId',
  'tenantId',
  'deviceAccessMode',
])
export const deviceQuerySchema = Type.Intersect(
  [
    querySyntax(deviceQueryProperties),
    // Add additional query properties
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type DeviceQuery = Static<typeof deviceQuerySchema>
//#endregion
