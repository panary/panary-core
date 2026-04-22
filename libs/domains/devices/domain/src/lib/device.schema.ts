import { querySyntax, Static, StringEnum, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary-core/shared-common'

//#region Enums & Constants (Reusable)
export const DeviceType = {
  POS_COUNTER: 'pos-counter',
  KDS: 'kds',
  TABLET: 'tablet',
  OTHER: 'other',
} as const
//#endregion

//#region The main data model (schema)
export const deviceSchema = Type.Object(
  {
    ...baseSchema,

    deviceId: Type.String({ format: 'uuid' }), // Unique device identifier (UUID), kept from old schema

    name: Type.String(),
    type: StringEnum(Object.values(DeviceType)),
    apiKeyId: Type.Optional(Type.String()),
    lastSeen: Type.Optional(Type.String({ format: 'date-time' })),
    active: Type.Boolean({ default: true }),
    metadata: Type.Optional(
      Type.Object({
        userAgent: Type.Optional(Type.String()),
        ipAddress: Type.Optional(Type.String()),
        version: Type.Optional(Type.String()),
      }),
    ),
    createdBy: Type.String(),
  },
  { $id: 'Device', additionalProperties: false },
)
export type Device = Static<typeof deviceSchema>
//#endregion

//#region Schema for creation (POST)
export const deviceDataSchema = Type.Object(
  {
    name: Type.String(),
    type: StringEnum(Object.values(DeviceType)),
    locationId: Type.String(),
    tenantId: Type.String(),
    metadata: Type.Optional(
      Type.Object({
        userAgent: Type.Optional(Type.String()),
        ipAddress: Type.Optional(Type.String()),
        version: Type.Optional(Type.String()),
      }),
    ),
    apiKeyId: Type.Optional(Type.String()),
    active: Type.Optional(Type.Boolean({ default: true })),
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
export const deviceQueryProperties = Type.Pick(deviceSchema, [
  '_id',
  'deviceId',
  'name',
  'type',
  'active',
  'locationId',
  'tenantId',
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
