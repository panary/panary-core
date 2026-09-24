import { describe, expect, it } from 'vitest'

import { addFormats, Ajv } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'

import {
  orderReferenceDataSchema,
  OrderReferenceType,
  orderReferenceQuerySchema,
  orderReferenceSchema,
} from './order-reference.schema'

// Schema-Spec fuer die Vorgangs-Referenzen (#348). Geprueft wird das Schema
// selbst — die Hook-Verdrahtung und die Append-only-Schichten haengen am
// Integrationstest in apps/api-edge/test/services/order-references/.
//
// Die drei Faelle unten sind keine Formalie: Jeder von ihnen ist beim Bauen
// einmal zugeschlagen, und zwar STILL.
// Mit derselben AJV-Konfiguration wie der Feathers-`dataValidator`
// (@panary/shared-backend) — `Value.Check` scheitert an StringEnum
// (Type.Unsafe), und genau die refType-Pruefung ist hier ein Punkt.
// Muster uebernommen aus device.schema.spec.ts.
const formats: FormatsPluginOptions = ['uuid', 'date-time']
const ajv = addFormats(new Ajv({}), formats)

const validData = (extra: Record<string, unknown> = {}) => ({
  refType: OrderReferenceType.STORNO,
  sourceOrderId: '01a0d1f5-e974-7984-8c08-bf3a3e34ace4',
  refDate: '2026-09-24T06:00:00.000Z',
  refLocationId: '01a0d1f5-e974-7984-8c08-bf3a3e34ace5',
  refBusinessDayId: '01a0d1f5-e974-7984-8c08-bf3a3e34ace6',
  ...extra,
})

describe('orderReferenceSchema', () => {
  it('kennt die vier DSFinV-K-Referenztypen', () => {
    expect(Object.values(OrderReferenceType)).toEqual(['Transaktion', 'Storno', 'Split', 'Umbuchung'])
  })

  it('ist geschlossen (additionalProperties: false)', () => {
    expect(orderReferenceSchema.additionalProperties).toBe(false)
  })

  it('verlangt sourceOrderId — eine Referenz ohne Ursprung hat keinen Aussagewert', () => {
    expect(orderReferenceSchema.required).toContain('sourceOrderId')
  })
})

describe('orderReferenceDataSchema (create)', () => {
  const validate = ajv.compile(orderReferenceDataSchema)

  it('akzeptiert eine vollstaendige Storno-Referenz', () => {
    expect(validate(validData())).toBe(true)
  })

  it('akzeptiert ein mitgeschicktes _id — sonst scheitert der Sync-Push', () => {
    // Offline am Edge erzeugte Records bringen ihre _id mit. Ohne die Erlaubnis
    // lehnte die Cloud den Sync-Create mit „additional properties [_id]" ab.
    expect(validate(validData({ _id: '01a0d1f5-e974-7984-8c08-bf3a3e34ace7' }))).toBe(true)
  })

  it('akzeptiert targetOrderId als null — SQLite liefert ungesetzte Spalten so', () => {
    // 🚨 Ohne den `Type.Null()`-Zweig verwuerfe die Cloud diesen Record beim
    // Sync-Push, und `classifyAcceptError` stuft das als TERMINAL ein:
    // Outbox `rejected`, kein Retry, kein Alarm.
    expect(validate(validData({ targetOrderId: null }))).toBe(true)
  })

  it('akzeptiert eine Referenz ohne Geschaeftstag (Standalone-Modus)', () => {
    // `order.businessDayId` ist ebenfalls optional. Als Pflichtfeld waere der
    // Create an validateData gescheitert — hinter einem best-effort-Hook also
    // lautlos.
    const ohneTag = validData()
    delete (ohneTag as Record<string, unknown>)['refBusinessDayId']
    expect(validate(ohneTag)).toBe(true)
  })

  it('akzeptiert refBusinessDayId als null', () => {
    expect(validate(validData({ refBusinessDayId: null }))).toBe(true)
  })

  it('weist ein unbekanntes Feld ab', () => {
    expect(validate(validData({ nichtImSchema: 'x' }))).toBe(false)
  })

  it('weist einen unbekannten refType ab', () => {
    expect(validate(validData({ refType: 'Irgendwas' }))).toBe(false)
  })
})

describe('orderReferenceQuerySchema', () => {
  it('fuehrt die Felder, ohne die find() mit 400 antwortet', () => {
    // `additionalProperties: false`: Was hier fehlt, existiert fuer den
    // Query-Validator nicht. tenantId/locationId braucht der multiTenancy-Hook,
    // createdAt/updatedAt der Sync-Backfill bzw. -Pull.
    const props = Object.keys(
      (orderReferenceQuerySchema as unknown as { properties: Record<string, unknown> }).properties,
    )

    for (const field of [
      'sourceOrderId',
      'targetOrderId',
      'refType',
      'tenantId',
      'locationId',
      'createdAt',
      'updatedAt',
    ]) {
      expect(props).toContain(field)
    }
  })
})
