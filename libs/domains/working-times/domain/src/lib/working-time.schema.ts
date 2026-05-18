import { querySyntax, Static, Type } from '@feathersjs/typebox'

//#region Subschemas
const breakSchema = Type.Object({
  from: Type.String(),
  to: Type.Union([Type.String(), Type.Null()]),
})
//#endregion

//#region Haupt-Datenmodell
export const workingTimeSchema = Type.Object(
  {
    _id: Type.String(),
    tenantId: Type.String(),
    locationId: Type.Union([Type.String(), Type.Null()]),
    userId: Type.String(),
    businessDay: Type.Optional(Type.String({ format: 'date' })),
    breaks: Type.Array(breakSchema),
    checkinDate: Type.String(),
    checkoutDate: Type.Union([Type.String(), Type.Null()]),
    originCheckinDate: Type.String(),
    originCheckoutDate: Type.Union([Type.String(), Type.Null()]),
    updatedBy: Type.Optional(Type.String()),
    createdAt: Type.String(),
    updatedAt: Type.String(),
  },
  { $id: 'WorkingTime', additionalProperties: false },
)
export type WorkingTime = Static<typeof workingTimeSchema>
//#endregion

//#region Schema für Erstellung (POST)
// `_id` als Optional, damit der Edge im Offline-First-Modus die uuidv7 lokal
// generieren kann und beim Sync-Push zur Cloud das Feld nicht als
// `additionalProperty` abgelehnt wird (analog zum `orderDataSchema`).
export const workingTimeDataSchema = Type.Intersect(
  [
    Type.Object({ _id: Type.Optional(Type.String()) }),
    Type.Pick(workingTimeSchema, ['userId']),
    Type.Partial(
      Type.Pick(workingTimeSchema, ['businessDay', 'checkinDate', 'tenantId', 'locationId']),
    ),
  ],
  { $id: 'WorkingTimeData', additionalProperties: false },
)
export type WorkingTimeData = Static<typeof workingTimeDataSchema>
//#endregion

//#region Schema für Updates (PATCH)
export const workingTimePatchSchema = Type.Partial(
  Type.Pick(workingTimeSchema, ['checkoutDate', 'originCheckoutDate', 'breaks', 'updatedBy']),
  { $id: 'WorkingTimePatch' },
)
export type WorkingTimePatch = Static<typeof workingTimePatchSchema>
//#endregion

//#region Schema für Suchanfragen (Query)
export const workingTimeQueryProperties = Type.Pick(workingTimeSchema, [
  '_id',
  'tenantId',
  'locationId',
  'userId',
  'businessDay',
  'checkinDate',
  'checkoutDate',
  'createdAt',
])
export const workingTimeQuerySchema = Type.Intersect(
  [
    querySyntax(workingTimeQueryProperties),
    Type.Object({}, { additionalProperties: false }),
  ],
  { additionalProperties: false },
)
export type WorkingTimeQuery = Static<typeof workingTimeQuerySchema>
//#endregion
