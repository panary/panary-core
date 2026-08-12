import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { fiscalCounterPatchSchema } from './fiscal-counter.schema'

/**
 * Der Cloud-Service `fiscal-counters` laeuft mit `multiTenancy()`. Der Hook
 * stempelt `tenantId` in `around.all` — also VOR `validateData` in
 * `before.patch`. Solange das Patch-Schema das Feld nicht kannte, lehnte AJV
 * jeden externen Patch mit 400 "validation failed" ab
 * (panary/panary-cloud#200).
 *
 * Die Schliessung war der Deklaration nicht anzusehen: Die Options setzen nur
 * `$id`, `additionalProperties: false` erbt `Type.Pick` vom Quell-Schema.
 * Deshalb prueft dieser Test das **kompilierte** Schema und nicht die Quelle.
 *
 * Beide Richtungen sind Absicht: Ein Test, der nur „tenantId geht durch" prueft,
 * waere auch mit `additionalProperties: true` gruen — also genau dann, wenn der
 * Schutz weg ist.
 */
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const validate = getValidator(fiscalCounterPatchSchema, addFormats(new Ajv({}), formats))

const TENANT_ID = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7c1'

describe('fiscalCounterPatchSchema — Hook-Stempel', () => {
  it('nimmt den Zaehler-Patch mitsamt tenantId an', async () => {
    await expect(validate({ lastValue: 42, tenantId: TENANT_ID })).resolves.toBeTruthy()
  })

  it('nimmt den Patch auch ohne Stempel an (interner Aufruf ohne Nutzer)', async () => {
    await expect(validate({ lastValue: 42 })).resolves.toBeTruthy()
  })

  it('lehnt unbekannte Felder weiterhin ab', async () => {
    await expect(validate({ lastValue: 42, tenantId: TENANT_ID, hackerFeld: 'x' })).rejects.toThrow()
  })

  it('lehnt einen negativen Zaehlerwert weiterhin ab', async () => {
    await expect(validate({ lastValue: -1, tenantId: TENANT_ID })).rejects.toThrow()
  })
})
