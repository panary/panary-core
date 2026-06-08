import type { Static } from '@feathersjs/typebox'
import { querySyntax, Type } from '@feathersjs/typebox'

/**
 * ReservableSlot-Schema (D-21).
 *
 * Ein Slot ist die Konfiguration „pro Wochentag, von HH:MM bis HH:MM, mit
 * Slot-Dauer X Minuten, maximal Y parallele Reservierungen". Wird vom Storefront
 * zur Verfügbarkeitsanzeige (`/reservable-slots-public`) gepullt und vom
 * Backend-Validation-Hook (D-23) zur Capacity-Prüfung verwendet.
 */
export const reservableSlotSchema = Type.Object(
  {
    _id: Type.String({ description: 'uuidv7' }),
    tenantId: Type.String({ description: 'uuidv7' }),
    brandId: Type.String({ description: 'uuidv7' }),
    locationId: Type.String({ description: 'uuidv7' }),
    weekday: Type.Integer({ minimum: 0, maximum: 6, description: '0 = Sonntag, 6 = Samstag' }),
    startTime: Type.String({
      pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$',
      description: 'HH:MM (00:00–23:59)',
    }),
    endTime: Type.String({
      pattern: '^([01][0-9]|2[0-3]):[0-5][0-9]$',
      description: 'HH:MM (00:00–23:59)',
    }),
    durationMinutes: Type.Integer({ minimum: 15, maximum: 480 }),
    maxConcurrentReservations: Type.Integer({ minimum: 1, maximum: 200 }),
    isActive: Type.Boolean({ default: true }),
    createdAt: Type.String({ description: 'ISO 8601' }),
    updatedAt: Type.String({ description: 'ISO 8601' }),
  },
  { $id: 'ReservableSlot', additionalProperties: false },
)
export type ReservableSlot = Static<typeof reservableSlotSchema>

export const reservableSlotDataSchema = Type.Omit(
  reservableSlotSchema,
  ['_id', 'createdAt', 'updatedAt'],
  { $id: 'ReservableSlotData', additionalProperties: false },
)
export type ReservableSlotData = Static<typeof reservableSlotDataSchema>

export const reservableSlotPatchSchema = Type.Partial(reservableSlotSchema, {
  $id: 'ReservableSlotPatch',
})
export type ReservableSlotPatch = Static<typeof reservableSlotPatchSchema>

export const reservableSlotQueryProperties = Type.Pick(reservableSlotSchema, [
  '_id',
  'tenantId',
  'brandId',
  'locationId',
  'weekday',
  'isActive',
])
export const reservableSlotQuerySchema = Type.Intersect(
  [querySyntax(reservableSlotQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type ReservableSlotQuery = Static<typeof reservableSlotQuerySchema>
