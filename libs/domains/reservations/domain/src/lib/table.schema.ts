import type { Static } from '@feathersjs/typebox'
import { querySyntax, Type } from '@feathersjs/typebox'

/**
 * Table-Schema (D-21) — Tisch im Restaurant.
 *
 * Tische sind brand- und location-scoped (Multi-Tenancy). `area` ist ein
 * freier Bezeichner wie „Terrasse" / „Erdgeschoss" — Filter-Hilfe für Staff.
 * `seats` ist die Sitzkapazität (1..30 — Tische über 30 sind Bankettsetups,
 * die V1 nicht abdeckt).
 */
export const tableSchema = Type.Object(
  {
    _id: Type.String({ description: 'uuidv7' }),
    tenantId: Type.String({ description: 'uuidv7' }),
    brandId: Type.String({ description: 'uuidv7' }),
    locationId: Type.String({ description: 'uuidv7' }),
    name: Type.String({ minLength: 1, maxLength: 60 }),
    seats: Type.Integer({ minimum: 1, maximum: 30 }),
    area: Type.Optional(Type.String({ maxLength: 60 })),
    isActive: Type.Boolean({ default: true }),
    createdAt: Type.String({ description: 'ISO 8601' }),
    updatedAt: Type.String({ description: 'ISO 8601' }),
  },
  { $id: 'Table', additionalProperties: false },
)
export type Table = Static<typeof tableSchema>

export const tableDataSchema = Type.Omit(tableSchema, ['_id', 'createdAt', 'updatedAt'], {
  $id: 'TableData',
  additionalProperties: false,
})
export type TableData = Static<typeof tableDataSchema>

export const tablePatchSchema = Type.Partial(tableSchema, { $id: 'TablePatch' })
export type TablePatch = Static<typeof tablePatchSchema>

export const tableQueryProperties = Type.Pick(tableSchema, [
  '_id',
  'tenantId',
  'brandId',
  'locationId',
  'isActive',
])
export const tableQuerySchema = Type.Intersect(
  [querySyntax(tableQueryProperties), Type.Object({}, { additionalProperties: false })],
  { additionalProperties: false },
)
export type TableQuery = Static<typeof tableQuerySchema>
