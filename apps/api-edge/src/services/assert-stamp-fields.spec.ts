// Tests fuer den Boot-Check aus assert-stamp-fields.ts.
//
// Drei Bloecke tragen den Wert: Der `apikeyDataSchema`-Block fuettert das ECHTE
// Schema ein und friert den Befund ein, der am 2026-08-01 `POST /apikeys`
// blockiert hat. Der Block „Service ohne docs.schemas" ist der Regressionstest
// fuer #183 — dort lief der Check an `sync-conflicts` vorbei, weil der Service
// keine `docs.schemas` deklariert, und das Boot-Log sah gesund aus. Der dritte
// prueft die aggregierte REQUIRED-Warnzeile selbst — sie ist das, woran man
// einen gesunden Boot erkennt (panary/panary-core#289), und bis dahin war nur
// der Befund getestet, nicht die Zeile, die ihn sichtbar macht.

import { describe, expect, it, vi } from 'vitest'
import { feathers } from '@feathersjs/feathers'
import { multiTenancy } from '@panary/shared-backend'
import { apikeyDataSchema } from '@panary/apikeys/domain'
import { validateData } from '../hooks/validate-data.hook'
import { logger } from '@panary/shared-backend'
import { assertStampFields, checkStampFields, collectStampTargets } from './assert-stamp-fields'

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
      // `as never` wie bei den uebrigen Stellen dieser Datei: der lokale `feathers()`
      // ist generisch typisiert, `multiTenancy` erwartet die Application aus den
      // shared-backend-declarations.
      app.service('widgets').hooks({ around: { all: [multiTenancy(mtOptions)] } } as never)
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

describe('checkStampFields() — PATCH-Schema (kind: patch)', () => {
  it('meldet fehlendes tenantId auch im Patch-Schema', () => {
    const violation = checkStampFields({
      path: 'sync-conflicts',
      dataSchema: closedSchema({ resolution: {} }),
      mtOptions: { isolateLocation: false, allowGlobalData: true },
      kind: 'patch',
    })
    expect(violation?.missing).toEqual(['tenantId'])
    expect(violation?.kind).toBe('patch')
    // Die Meldung muss die Seite nennen, sonst sucht man im Data-Schema.
    expect(violation?.message).toContain('PATCH-Schema')
    expect(violation?.message).toContain('externe Patch')
  })

  // Die REQUIRED-Regel ist eine DATA-Regel. In Patch-Schemas ist praktisch
  // alles optional; sie dort mitzupruefen erzeugte in der Cloud beim ersten
  // Lauf 13 Falschmeldungen.
  it('REQUIRED wird im Patch-Schema NICHT gemeldet', () => {
    const schema = closedSchema({ tenantId: {}, resolution: {} }, ['tenantId'])
    expect(checkStampFields({ path: 'w', dataSchema: schema, mtOptions: {}, kind: 'data' })?.required).toEqual([
      'tenantId',
    ])
    expect(checkStampFields({ path: 'w', dataSchema: schema, mtOptions: {}, kind: 'patch' })).toBeNull()
  })
})

// REGRESSION #183 (2026-09-12): `sync-conflicts` deklariert kein
// `docs.schemas`. Solange der Check ausschliesslich dort nachsah, war der
// Service unsichtbar — „Verwerfen" auf einem offenen Sync-Konflikt antwortete
// mit „Mandant: must NOT have additional properties", und kein Gate schlug an.
// Das Schema kommt jetzt aus dem markierten Validierungs-Hook.
describe('assertStampFields() — Service OHNE docs.schemas wird trotzdem geprueft', () => {
  const buildApp = (patchSchema: Record<string, unknown>) => {
    const app = feathers()
    app.use(
      'widgets',
      {
        async patch(_id: unknown, d: unknown) {
          return d
        },
      } as never,
      // Bewusst KEINE docs.schemas — genau die Lage von sync-conflicts.
      { methods: ['patch'], events: [] } as never,
    )
    app.service('widgets').hooks({
      around: { all: [multiTenancy({ isolateLocation: false })] },
      // Der Validator ist hier eine Attrappe: Der Check liest nur `.schema`,
      // die AJV-ValidateFunction wird nie aufgerufen.
      before: { patch: [validateData(Object.assign(async (d: unknown) => d, { schema: patchSchema }))] },
    } as never)
    return app
  }

  it('findet den PATCH-Verstoss allein aus dem markierten Hook', () => {
    const [violation, ...rest] = assertStampFields(buildApp(closedSchema({ resolution: {} })) as never)
    expect(rest).toEqual([])
    expect(violation.path).toBe('widgets')
    expect(violation.kind).toBe('patch')
    expect(violation.missing).toEqual(['tenantId'])
  })

  it('das reparierte Schema (tenantId optional) erzeugt keinen Befund', () => {
    expect(assertStampFields(buildApp(closedSchema({ resolution: {}, tenantId: {} })) as never)).toEqual([])
  })

  it('die Quelle ist der Hook, nicht docs.schemas — sonst waere die Luecke zurueck', () => {
    const targets = collectStampTargets(buildApp(closedSchema({ resolution: {} })) as never)
    expect(targets.find(t => t.kind === 'patch')?.source).toBe('hook')
    expect(targets.find(t => t.kind === 'data')?.source).toBe('none')
  })
})

// Die aggregierte Warnzeile (panary/panary-core#289). Getestet wird hier nicht
// der Befund — das tut der erste Block —, sondern die Stelle, an der
// `REQUIRED_STAMP_EXCEPTIONS` wirkt: Sie ist das einzige, was zwischen
// „gesundes Boot-Log" und „Zeile, die jeden neuen Fall verdeckt" steht. Ohne
// diesen Block war sie ungetestet, und ein Filterfehler haette wie Gesundheit
// ausgesehen.
describe('assertStampFields() — REQUIRED-Warnzeile und Ausnahmeliste', () => {
  const buildApp = (path: string) => {
    const app = feathers()
    app.use(
      path,
      {
        async create(d: unknown) {
          return d
        },
      } as never,
      { methods: ['create'], events: [] } as never,
    )
    app.service(path as never).hooks({
      around: { all: [multiTenancy({ isolateLocation: false })] },
      before: {
        create: [
          validateData(
            Object.assign(async (d: unknown) => d, {
              // tenantId vorhanden UND Pflicht → genau der REQUIRED-Fall.
              schema: closedSchema({ tenantId: {}, name: {} }, ['tenantId', 'name']),
            }),
          ),
        ],
      },
    } as never)
    return app
  }

  const warnCalls = () =>
    vi
      .mocked(logger.warn)
      .mock.calls.filter(([arg]) => (arg as { event?: string })?.event === 'service.stamp_field_required')

  it('meldet den Service namentlich, wenn er NICHT in der Ausnahmeliste steht', () => {
    vi.mocked(logger.warn).mockClear()
    assertStampFields(buildApp('widgets') as never)

    const [[arg]] = warnCalls()
    expect((arg as { services: string[] }).services).toEqual(['widgets:tenantId'])
  })

  it('schweigt fuer einen Service aus REQUIRED_STAMP_EXCEPTIONS', () => {
    vi.mocked(logger.warn).mockClear()
    // `sync-runs` steht mit Begruendung in der Liste (blockExternalWrites).
    const violations = assertStampFields(buildApp('sync-runs') as never)

    // Der Befund existiert weiter — unterdrueckt wird nur die Log-Zeile. Sonst
    // saehe das Gate, das denselben Befund auswertet, gar nichts mehr.
    expect(violations.map(v => `${v.path}:${v.required.join()}`)).toContain('sync-runs:tenantId')
    expect(warnCalls()).toEqual([])
  })
})
