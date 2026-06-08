import type { Static } from '@feathersjs/typebox'
import { querySyntax, Type } from '@feathersjs/typebox'

import { reservationStatusValues } from './reservation.enums'

/**
 * Reservation-Schema (D-21) — Customer-facing Reservierung mit State-Machine.
 *
 * Felder:
 *  - `tenantId`, `brandId`, `locationId` — Multi-Tenancy 3-Schichten (D-06).
 *  - `customerName/Email/Phone` — Customer-Daten (Phone optional).
 *  - `partySize` — Anzahl Personen (1..50).
 *  - `reservedFor` — ISO 8601-Zeitstempel der Reservierung.
 *  - `reservedSlotId` — FK auf ReservableSlot.
 *  - `tableId?` — Optional, vom Staff zugeordnet (Auto-Assign DEFERRED).
 *  - `status` — Lifecycle (pending/confirmed/cancelled/no-show, D-24).
 *  - `notes`/`staffNotes` — Customer- vs internal-Notes.
 *  - `manageToken?` — HMAC, NUR im CREATE-Response; sonst über resolveExternal
 *    geschützt (D-25, server-side gesetzt).
 */
export const reservationSchema = Type.Object(
  {
    _id: Type.String({ description: 'uuidv7' }),
    tenantId: Type.String({ description: 'uuidv7' }),
    brandId: Type.String({ description: 'uuidv7 — Phase 6 BRAND-01' }),
    locationId: Type.String({ description: 'uuidv7' }),
    customerName: Type.String({ minLength: 1, maxLength: 200 }),
    customerEmail: Type.String({ format: 'email', maxLength: 320 }),
    customerPhone: Type.Optional(Type.String({ maxLength: 40 })),
    partySize: Type.Integer({ minimum: 1, maximum: 50 }),
    reservedFor: Type.String({ description: 'ISO 8601' }),
    reservedSlotId: Type.String({ description: 'uuidv7' }),
    tableId: Type.Optional(Type.String({ description: 'uuidv7' })),
    status: Type.Union(reservationStatusValues.map(v => Type.Literal(v))),
    notes: Type.Optional(Type.String({ maxLength: 1000 })),
    staffNotes: Type.Optional(Type.String({ maxLength: 2000 })),
    manageToken: Type.Optional(
      Type.String({ description: 'HMAC-Token (im response NUR beim CREATE)' }),
    ),
    createdAt: Type.String({ description: 'ISO 8601' }),
    updatedAt: Type.String({ description: 'ISO 8601' }),
  },
  { $id: 'Reservation', additionalProperties: false },
)
export type Reservation = Static<typeof reservationSchema>

export const reservationDataSchema = Type.Omit(
  reservationSchema,
  ['_id', 'manageToken', 'createdAt', 'updatedAt'],
  { $id: 'ReservationData', additionalProperties: false },
)
export type ReservationData = Static<typeof reservationDataSchema>

export const reservationPatchSchema = Type.Partial(
  Type.Omit(reservationSchema, ['_id', 'tenantId', 'brandId', 'manageToken', 'createdAt', 'updatedAt']),
  { $id: 'ReservationPatch' },
)
export type ReservationPatch = Static<typeof reservationPatchSchema>

export const reservationQueryProperties = Type.Pick(reservationSchema, [
  '_id',
  'tenantId',
  'brandId',
  'locationId',
  'status',
  'reservedFor',
  'tableId',
  'reservedSlotId',
])
export const reservationQuerySchema = Type.Intersect(
  [querySyntax(reservationQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type ReservationQuery = Static<typeof reservationQuerySchema>
