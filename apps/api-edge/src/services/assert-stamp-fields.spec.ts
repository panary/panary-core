// Tests fuer den Boot-Check aus assert-stamp-fields.ts.
//
// Der letzte Block ist der eigentliche Wert: er fuettert das ECHTE
// `apikeyDataSchema` ein und friert damit den Befund ein, der am 2026-08-01
// `POST /apikeys` blockiert hat.

import { describe, expect, it, vi } from 'vitest'
import { feathers } from '@feathersjs/feathers'
import { multiTenancy } from '@panary/shared-backend'
import { apikeyDataSchema } from '@panary/apikeys/domain'
import { assertStampFields, checkStampFields } from './assert-stamp-fields'

vi.mock('@panary/shared-backend', async importOriginal => {
  const actual = await importOriginal<typeof import('@panary/shared-backend')>()
  return { ...actual, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }
})

const closedSchema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
})

describe('checkStampFields() — MISSING (Feld fehlt im geschlossenen Schema)', () => {
  it('meldet fehlendes tenantId', () => {
    const violation = checkStampFields({
      path: 'widgets',
      dataSchema: closedSchema({ name: {} }),
      mtOptions: {},
    })
    expect(violation?.missing).toEqual(['tenantId'])
    expect(violation?.message).toContain('additionalProperties: false')
  })

  it('meldet fehlendes locationId nur bei isolateLocation', () => {
    const schema = closedSchema({ name: {}, tenantId: {} })
    expect(checkStampFields({ path: 'w', dataSchema: schema, mtOptions: {} })).toBeNull()
    expect(checkStampFields({ path: 'w', dataSchema: schema, mtOptions: { isolateLocation: true } })?.missing).toEqual([
      'locationId',
    ])
  })

  it('offenes Schema (additionalProperties nicht false) ist unkritisch', () => {
    const violation = checkStampFields({
      path: 'w',
      dataSchema: { type: 'object', properties: { name: {} } },
      mtOptions: { isolateLocation: true },
    })
    expect(violation).toBeNull()
  })

  it('findet Felder auch ueber allOf-Zweige (Type.Intersect in aelterer Form)', () => {
    const violation = checkStampFields({
      path: 'w',
      dataSchema: {
        allOf: [{ properties: { tenantId: {} } }, { properties: { locationId: {} }, additionalProperties: false }],
      },
      mtOptions: { isolateLocation: true },
    })
    expect(violation).toBeNull()
  })
})

describe('checkStampFields() — REQUIRED (Server-Stempel als Client-Pflichtfeld)', () => {
  it('meldet gestempelte Pflichtfelder', () => {
    const violation = checkStampFields({
      path: 'widgets',
      dataSchema: closedSchema({ name: {}, tenantId: {}, locationId: {} }, ['name', 'tenantId', 'locationId']),
      mtOptions: { isolateLocation: true },
    })
    expect(violation?.required).toEqual(['tenantId', 'locationId'])
    expect(violation?.missing).toEqual([])
  })

  it('optionale Stempel-Felder sind sauber', () => {
    const violation = checkStampFields({
      path: 'widgets',
      dataSchema: closedSchema({ name: {}, tenantId: {}, locationId: {} }, ['name']),
      mtOptions: { isolateLocation: true },
    })
    expect(violation).toBeNull()
  })

  it('REQUIRED greift auch im offenen Schema (unabhaengig von additionalProperties)', () => {
    const violation = checkStampFields({
      path: 'w',
      dataSchema: { type: 'object', properties: { tenantId: {} }, required: ['tenantId'] },
      mtOptions: {},
    })
    expect(violation?.required).toEqual(['tenantId'])
  })
})

describe('checkStampFields() — kein multiTenancy am Service', () => {
  it('ohne Optionen wird nichts geprueft (sync-interne Pfade)', () => {
    expect(checkStampFields({ path: 'sync-outbox', dataSchema: closedSchema({}), mtOptions: null })).toBeNull()
  })

  it('ohne Data-Schema wird nichts geprueft', () => {
    expect(checkStampFields({ path: 'w', dataSchema: undefined, mtOptions: { isolateLocation: true } })).toBeNull()
  })
})

describe('assertStampFields() — Sweep ueber registrierte Services', () => {
  const buildApp = (docsSchemas: Record<string, unknown>, mtOptions: Parameters<typeof multiTenancy>[0] | null) => {
    const app = feathers()
    app.use(
      'widgets',
      {
        async create(d: unknown) {
          return d
        },
      } as never,
      {
        methods: ['create'],
        events: [],
        docs: { schemas: docsSchemas },
      } as never,
    )
    if (mtOptions !== null) {
      app.service('widgets').hooks({ around: { all: [multiTenancy(mtOptions)] } })
    }
    return app
  }

  it('liest die multiTenancy-Optionen aus der around.all-Kette des Services', () => {
    const app = buildApp({ widgetData: closedSchema({ name: {} }) }, { isolateLocation: true })
    const [violation] = assertStampFields(app as never)
    expect(violation.path).toBe('widgets')
    expect(violation.missing).toEqual(['tenantId', 'locationId'])
  })

  it('Service ohne multiTenancy-Hook wird uebersprungen', () => {
    const app = buildApp({ widgetData: closedSchema({ name: {} }) }, null)
    expect(assertStampFields(app as never)).toEqual([])
  })

  it('Service ohne <name>Data in docs.schemas wird uebersprungen', () => {
    const app = buildApp({ widget: closedSchema({ name: {} }) }, { isolateLocation: true })
    expect(assertStampFields(app as never)).toEqual([])
  })

  it('sauberer Service erzeugt keinen Befund', () => {
    const app = buildApp({ widgetData: closedSchema({ name: {}, tenantId: {}, locationId: {} }, ['name']) }, {})
    expect(assertStampFields(app as never)).toEqual([])
  })
})

// REGRESSION 2026-08-01: `apikeys` fuehrte `tenantId`/`locationId` als
// Pflichtfelder im DATA-Schema, obwohl multiTenancy() sie stempelt. Aus dieser
// Kopplung entstand der 400 „must have required property 'locationId'", der
// auf den Client zeigte, obwohl die Ursache serverseitig lag. Die Felder sind
// inzwischen optional — dieser Test haelt das fest.
describe('apikeyDataSchema — Schema-Falle aus dem Bug vom 2026-08-01', () => {
  it('tenantId/locationId sind optional, nicht Pflicht', () => {
    const violation = checkStampFields({
      path: 'apikeys',
      dataSchema: apikeyDataSchema,
      mtOptions: { isolateLocation: true, allowGlobalData: false },
    })
    expect(violation).toBeNull()
  })

  it('die Felder sind weiterhin DEKLARIERT — sonst lehnt AJV den Stempel ab', () => {
    // Optional heisst nicht „entfernt": das Schema ist geschlossen
    // (`additionalProperties: false`), ein nicht deklariertes Feld wuerde vom
    // gestempelten Wert als `additionalProperty` abgelehnt. Genau diese zweite
    // Falle prueft die MISSING-Regel.
    const props = (apikeyDataSchema as { properties?: Record<string, unknown> }).properties ?? {}
    expect(Object.keys(props)).toEqual(expect.arrayContaining(['tenantId', 'locationId']))
  })
})
