import { querySyntax, Static, Type } from '@feathersjs/typebox'
import { baseSchema } from '@panary/shared-common'

//#region Das Haupt-Datenmodell (Schema)
export const openingHourExceptionSchema = Type.Object(
  {
    ...baseSchema,
    date: Type.String({ format: 'date' }), // "YYYY-MM-DD"
    label: Type.Optional(Type.String({ maxLength: 120 })), // z.B. "Heiligabend", "Betriebsurlaub"
    closed: Type.Boolean({ default: true }),
    open: Type.Optional(Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$' })), // "HH:mm" — überschriebene Öffnungszeit
    close: Type.Optional(Type.String({ pattern: '^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$' })), // "HH:mm" — überschriebene Schließzeit
  },
  { $id: 'OpeningHourException', additionalProperties: false },
)
export type OpeningHourException = Static<typeof openingHourExceptionSchema>
//#endregion

//#region Schema für Erstellung (POST)
export const openingHourExceptionDataSchema = Type.Omit(
  openingHourExceptionSchema,
  ['_id', 'createdAt', 'updatedAt'],
  { $id: 'OpeningHourExceptionData', additionalProperties: false },
)
export type OpeningHourExceptionData = Static<typeof openingHourExceptionDataSchema>
//#endregion

//#region Schema für Updates (PATCH)
export const openingHourExceptionPatchSchema = Type.Partial(openingHourExceptionSchema, {
  $id: 'OpeningHourExceptionPatch',
})
export type OpeningHourExceptionPatch = Static<typeof openingHourExceptionPatchSchema>
//#endregion

//#region Schema für Suchanfragen (Query)
export const openingHourExceptionQueryProperties = Type.Pick(openingHourExceptionSchema, [
  '_id',
  'tenantId',
  'locationId',
  'date',
  'closed',
])
export const openingHourExceptionQuerySchema = Type.Intersect(
  [
    querySyntax(openingHourExceptionQueryProperties),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type OpeningHourExceptionQuery = Static<typeof openingHourExceptionQuerySchema>
//#endregion
