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
// Edge pusht beim Sync den vollen WorkingTime-Datensatz (inkl. breaks,
// checkoutDate, originCheckinDate, originCheckoutDate, updatedAt, createdAt,
// updatedBy). Eine restriktive Pick-Variante hat dazu geführt, dass die
// Cloud den Push mit `<root>: must NOT have additional properties` abgelehnt
// hat — ohne Feldnamen, was die Ursache schwer auffindbar machte.
//
// `Type.Partial(workingTimeSchema)` erlaubt jedes Domain-Feld optional;
// `_id` bleibt separat, weil das Domain-Schema es als required deklariert,
// der Sync-Push aber clientseitig generierte uuidv7-Werte erlaubt und ein
// `create` ohne `_id` (manuelle Anlage über die Admin-UI) auch funktionieren
// muss. `additionalProperties: false` bleibt strikt — Edge darf keine
// unbekannten Feldnamen einschleusen. Pflicht-Validierung (mindestens
// `userId`) macht der Service-Layer (Resolver/Hook) bzw. das UI-Form
// (FormControl), nicht das Sync-Schema — konsistent zu `order.schema.ts`
// und robust gegen künftige Schema-Erweiterungen.
export const workingTimeDataSchema = Type.Intersect(
  [
    Type.Object({ _id: Type.Optional(Type.String()) }),
    Type.Partial(workingTimeSchema),
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
