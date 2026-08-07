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
// `_id`, `createdAt`, `updatedAt` werden serverseitig gesetzt — fuer den
// Cloud→Edge-Sync-Pull-Apply muessen sie aber als Optional erlaubt bleiben:
// die Cloud materialisiert Feiertage/Schliesstage als fertige Records, die der
// Edge per CREATE uebernimmt (die _ids sind am Edge immer neu). Ohne diese
// Felder lehnte validateData JEDEN gepullten Record terminal ab — der Service
// konnte strukturell nie synchronisieren. Muster identisch zu customerDataSchema.
export const openingHourExceptionDataSchema = Type.Intersect(
  [
    Type.Omit(openingHourExceptionSchema, ['_id', 'createdAt', 'updatedAt']),
    Type.Partial(Type.Pick(openingHourExceptionSchema, ['_id', 'createdAt', 'updatedAt'])),
  ],
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
  [querySyntax(openingHourExceptionQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type OpeningHourExceptionQuery = Static<typeof openingHourExceptionQuerySchema>
//#endregion
