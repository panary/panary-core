import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { ReservationStatus } from './reservation.enums'
import { reservationPatchSchema } from './reservation.schema'

/**
 * Der Cloud-Service `reservations` laeuft mit
 * `multiTenancy({ isolateBrand: true })`. Der Hook stempelt `tenantId` **und**
 * `brandId` in `around.all` — also VOR `validateData` in `before.patch`. Beide
 * standen bis panary/panary-cloud#200 in der Omit-Liste des Patch-Schemas,
 * weshalb jeder externe Patch mit 400 "validation failed" scheiterte.
 *
 * Die Schliessung war der Deklaration nicht anzusehen: Die Options setzen nur
 * `$id`, `additionalProperties: false` erbt `Type.Omit` vom Quell-Schema.
 *
 * Der Ausschluss der uebrigen Felder bleibt bestehen — `_id`, `manageToken`,
 * `createdAt` und `updatedAt` duerfen weiterhin nicht gepatcht werden. Genau
 * das prueft der letzte Test, damit die geloeste Omit-Liste nicht unbemerkt
 * weiter aufgeht.
 */
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const validate = getValidator(reservationPatchSchema, addFormats(new Ajv({}), formats))

const TENANT_ID = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7c1'
const BRAND_ID = '01927d4f-3c2e-7b6a-9a1f-1ce0a8a5d7c2'

/** Was `multiTenancy({ isolateBrand: true })` in jeden externen Patch schreibt. */
const STAMPED = { tenantId: TENANT_ID, brandId: BRAND_ID }

describe('reservationPatchSchema — Hook-Stempel', () => {
  it('nimmt eine Status-Aenderung mitsamt tenantId + brandId an', async () => {
    await expect(validate({ status: ReservationStatus.CONFIRMED, ...STAMPED })).resolves.toBeTruthy()
  })

  it('nimmt einen Patch an, der nur aus den Stempeln besteht', async () => {
    await expect(validate({ ...STAMPED })).resolves.toBeTruthy()
  })

  it('lehnt unbekannte Felder weiterhin ab', async () => {
    // Status bewusst gueltig — sonst schluege der Test wegen des Status an und
    // nicht wegen `hackerFeld`, waere also gruen aus dem falschen Grund.
    await expect(validate({ status: ReservationStatus.CONFIRMED, ...STAMPED, hackerFeld: 'x' })).rejects.toMatchObject({
      errors: [expect.objectContaining({ keyword: 'additionalProperties' })],
    })
  })

  it('haelt die uebrigen Ausschluesse — _id, manageToken, createdAt, updatedAt', async () => {
    for (const feld of ['_id', 'manageToken', 'createdAt', 'updatedAt']) {
      await expect(validate({ ...STAMPED, [feld]: 'x' }), feld).rejects.toThrow()
    }
  })
})
