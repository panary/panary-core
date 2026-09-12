// Wo kann „Online-Version uebernehmen" ueberhaupt am Schema scheitern?
//
// Der Apply patcht den Cloud-Record in den Zielservice. Gefaehrlich ist das nur
// dort, wo das PATCH-Schema ENGER ist als der Record und zugleich geschlossen
// (`additionalProperties: false`) — sonst nimmt der Service den vollen Record an.
// Ein Konflikt kann nur fuer push-faehige Services entstehen
// (`SyncableTransactionService`), also ist das die Grundmenge.
//
// Gemessen am kompilierten Schema, nicht per grep: `libs/domains/...` und der
// Service koennen jederzeit auseinanderlaufen, und ein Textfund saehe in beiden
// Faellen gleich aus.
//
// Diese Spec haelt die Messung fest, damit sie nicht still altert: Wird ein
// weiteres Patch-Schema verengt (oder `working-times` aufgeweitet), wird sie rot
// und zwingt zur Entscheidung.

import { feathers } from '@feathersjs/feathers'
import { describe, expect, it, vi } from 'vitest'

import { SyncableTransactionService } from '@panary/edge-pairing/domain'
import { DatabaseType } from '@panary/shared-common'

import { collectSchemaShape, readServiceMethods, readServiceSchema } from '../schema-shape'
import { services } from '../index'

vi.mock('@panary/shared-backend', async importOriginal => {
  const actual = await importOriginal<typeof import('@panary/shared-backend')>()
  return { ...actual, logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } }
})

/**
 * Services, deren PATCH-Schema den vollen Record NICHT annimmt — Stand
 * 2026-09-12. Der Wert ist die Begruendung, warum die Enge gewollt ist.
 *
 * Zielzustand ist NICHT die leere Liste: Ein enges Patch-Schema ist Absicht
 * (`.claude/rules/security.md` §8) und wird nicht aufgeweitet, damit der Apply
 * durchlaeuft — der Apply reduziert stattdessen den Record
 * (`apply-resolution.ts`).
 */
const ENGE_PATCH_SCHEMAS: Record<string, string> = {
  'working-times': '_id/userId/checkinDate/businessDay/locationId sind extern nicht aenderbar (Zeiterfassung)',
}

const anyStub: unknown = new Proxy(
  function stub() {
    return undefined
  } as unknown as object,
  { get: () => anyStub, apply: () => anyStub, construct: () => anyStub as object },
)

const makeApp = () => {
  const app = feathers()
  app.get = ((key: string) => (key === 'system' ? { dbType: DatabaseType.SQLITE } : anyStub)) as never
  services(app as never)
  return app
}

/** Push-faehige Services mit registriertem Patch — nur die kann ein Apply treffen. */
const patchbareZiele = () => {
  const app = makeApp()
  return Object.values(SyncableTransactionService)
    .map(path => ({ path, service: app.service(path as never) }))
    .filter(({ service }) => readServiceMethods(service).includes('patch'))
}

describe('Konflikt-Apply: Reichweite der Schema-Verengung', () => {
  it('nur die dokumentierten Services haben ein engeres PATCH- als DATA-Schema', () => {
    const eng: string[] = []

    for (const { path, service } of patchbareZiele()) {
      const patch = readServiceSchema(service, 'patch')
      const data = readServiceSchema(service, 'data')
      if (!patch.schema || !data.schema) continue

      const patchShape = collectSchemaShape(patch.schema)
      const dataShape = collectSchemaShape(data.schema)
      const fehlend = [...dataShape.fields].filter(field => !patchShape.fields.has(field))
      // Offene Schemas nehmen Zusatzfelder an — dort ist die Enge folgenlos.
      if (patchShape.closed && fehlend.length > 0) eng.push(path)
    }

    expect(eng.sort(), 'Neuer Service mit engem PATCH-Schema — Apply und Doku pruefen').toEqual(
      Object.keys(ENGE_PATCH_SCHEMAS).sort(),
    )
  })

  it('jeder push-faehige Service liefert sein PATCH-Schema aus dem markierten Hook', () => {
    // Ohne lesbares Schema kann `reduceToPatchableFields` nicht reduzieren und
    // faellt auf „vollen Record senden" zurueck — also genau auf das Verhalten
    // von vor #293. Diese Blindheit darf nicht unbemerkt nachwachsen.
    const blind = patchbareZiele()
      .filter(({ service }) => readServiceSchema(service, 'patch').source !== 'hook')
      .map(({ path }) => path)

    expect(blind, 'PATCH ohne markiertes Schema — validateData() aus hooks/validate-data.hook.ts benutzen').toEqual([])
  })
})
