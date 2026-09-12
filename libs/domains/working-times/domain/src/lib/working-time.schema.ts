import { querySyntax, Static, Type } from '@feathersjs/typebox'

//#region Subschemas
const breakSchema = Type.Object({
  from: Type.String({ format: 'date-time' }),
  to: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
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
    breaks: Type.Array(breakSchema, { maxItems: 50 }),
    checkinDate: Type.String({ format: 'date-time' }),
    checkoutDate: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    originCheckinDate: Type.String({ format: 'date-time' }),
    originCheckoutDate: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
    updatedBy: Type.Optional(Type.String({ maxLength: 64 })),
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
  [Type.Object({ _id: Type.Optional(Type.String()) }), Type.Partial(workingTimeSchema)],
  { $id: 'WorkingTimeData', additionalProperties: false },
)
export type WorkingTimeData = Static<typeof workingTimeDataSchema>
//#endregion

//#region Schema für Updates (PATCH)
// `tenantId` gehört in die Auswahl, obwohl es nie ein Client schickt:
// `multiTenancy()` stempelt es in `around.all` auf JEDEN Write — auch auf
// `patch` — und zwar BEVOR `validateData` in `before.patch` greift. Da
// `Type.Pick` das `additionalProperties: false` von `workingTimeSchema` erbt,
// scheiterte jeder EXTERNE Patch mit 400 „validation failed" („Mandant: must
// NOT have additional properties"). Betroffen war zuletzt die
// Konflikt-Auflösung „Cloud übernehmen": Sie patcht den vollständigen
// Cloud-Record, der `tenantId` trägt.
//
// `Type.Partial` macht das Feld optional — eine Erlaubnis ist es nicht: der
// Hook überschreibt jeden mitgesendeten Wert und `workingTimePatchResolver`
// verwirft ihn zusätzlich (`tenantId: async () => undefined`).
//
// Gleiche Klasse wie panary/panary-core#183 (sync-conflicts) und
// panary/panary-cloud#200 (fiscal-counter, reservation); gefunden vom
// erweiterten Boot-Check aus panary/panary-core#267.
export const workingTimePatchSchema = Type.Partial(
  Type.Pick(workingTimeSchema, ['checkoutDate', 'originCheckoutDate', 'breaks', 'updatedBy', 'tenantId']),
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
  [querySyntax(workingTimeQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type WorkingTimeQuery = Static<typeof workingTimeQuerySchema>
//#endregion
