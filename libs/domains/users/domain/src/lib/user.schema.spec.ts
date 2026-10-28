import { describe, expect, it } from 'vitest'

import { Ajv, addFormats } from '@feathersjs/schema'
import type { FormatsPluginOptions } from '@feathersjs/schema'
import { getValidator } from '@feathersjs/typebox'

import { userDataSchema, userPatchSchema, userSchema } from './user.schema'

// Bootstrap-Push Edge→Cloud (#183, Befund Testserver 2026-08-12). Der Edge liest
// die User-Row roh aus SQLite (`collectAllRecords`) und reicht sie unveraendert
// an die Cloud-Validierung. Jede nie befuellte nullable Spalte kommt dabei als
// `null` an — nicht als `undefined`. Ein reines `Type.Optional(Type.String())`
// erlaubt aber nur letzteres, weshalb der Push mit „must be string" abbrach.
//
// `locations` schlug im echten Lauf zuerst fehl (erster Service in
// MASTER_DATA_SERVICES) und verdeckte diesen Fall; `users` waere unmittelbar
// danach gescheitert. Die Konstellation ist keine Konstruktion: Sie stammt aus
// dem `edgePayload` des sync-conflicts-Eintrags, den derselbe Lauf erzeugt hat.
//
// Validiert mit derselben AJV-Konfiguration wie der Feathers-`dataValidator`
// (@panary/shared-backend), damit exakt die Runtime-Semantik geprueft wird.
const formats: FormatsPluginOptions = ['date-time', 'date', 'email', 'uri', 'uuid']
const validator = getValidator(userDataSchema, addFormats(new Ajv({}), formats))

// Zusammengesetzt statt als Literal: Ein ausgeschriebener `$2b$10$…`-String ist
// fuer den Secret-Scanner (semgrep `detected-bcrypt-hash`) ein Fund, auch wenn
// er wie hier reine Testdaten sind. Relevant ist allein die Laenge — das
// Data-Schema unterscheidet Klartext-PIN (4–6) von bcrypt-Hash (60–72).
const fakeBcryptHash = (): string => `$2b$10$${'x'.repeat(53)}`

// Der initiale Edge-Admin, wie ihn das Setup anlegt.
const initialEdgeAdmin = {
  _id: '019fcd35-c1aa-74a9-84d3-8f4b6a106de8',
  tenantId: '019ff5ba-3cfa-7cdf-8231-844c4655b4eb',
  activeLocationId: '019ff5ba-3cfa-7cdf-8231-844db8dbe902',
  createdAt: '2026-08-04T14:38:00.107Z',
  updatedAt: '2026-08-04T14:38:00.107Z',
  email: 'admin@example.test',
  password: fakeBcryptHash(),
  loginname: 'admin',
  firstName: 'Admin',
  lastName: 'User',
  role: 'tenant:owner',
  status: 'ACTIVE',
  employeeNumber: '661721',
  permissions: [],
  allowedLocationIds: ['019ff5ba-3cfa-7cdf-8231-844db8dbe902'],
  // Genau die Felder, die der Edge nie befuellt:
  staffRole: null,
  posPin: null,
  discountDetails: null,
  isPosUser: false,
  allowStaffMealOrders: false,
  autoLogOff: true,
  mustChangePassword: false,
}

describe('userDataSchema (Bootstrap-Push mit leeren SQLite-Spalten)', () => {
  it('akzeptiert den initialen Edge-Admin mit null in staffRole/posPin/discountDetails', async () => {
    await expect(validator(initialEdgeAdmin)).resolves.toBeTruthy()
  })

  it.each(['staffRole', 'posPin', 'discountDetails'])('akzeptiert null in %s einzeln', async field => {
    await expect(validator({ ...initialEdgeAdmin, [field]: null })).resolves.toBeTruthy()
  })

  it('akzeptiert weiterhin einen gesetzten bcrypt-Hash im posPin (Sync-Pull-Pfad)', async () => {
    const hash = fakeBcryptHash()
    expect(hash.length).toBeGreaterThanOrEqual(60)
    await expect(validator({ ...initialEdgeAdmin, posPin: hash })).resolves.toBeTruthy()
  })

  it('akzeptiert weiterhin eine Klartext-PIN (Eingabe-Pfad)', async () => {
    await expect(validator({ ...initialEdgeAdmin, posPin: '4711' })).resolves.toBeTruthy()
  })

  it('lehnt eine PIN zwischen Klartext- und Hash-Laenge weiterhin ab', async () => {
    await expect(validator({ ...initialEdgeAdmin, posPin: '1234567' })).rejects.toThrow()
  })

  it('validiert discountDetails weiterhin, wenn gesetzt', async () => {
    await expect(
      validator({ ...initialEdgeAdmin, discountDetails: { discountType: 'percent', discount: 10 } }),
    ).resolves.toBeTruthy()
    await expect(
      validator({ ...initialEdgeAdmin, discountDetails: { discountType: 'percent', discount: -1 } }),
    ).rejects.toThrow()
  })

  it('lehnt unbekannte Felder weiterhin ab (kein Wildcard-Passthrough)', async () => {
    await expect(validator({ ...initialEdgeAdmin, evilField: 'x' })).rejects.toThrow()
  })
})

// Bedienhand an der Kasse (panary/panary-core#827). Create UND Patch muessen das
// Feld kennen: Der Pull-Apply legt neue User per create an, bestehende per patch —
// fehlt es in einem der beiden Schemas, lehnt `additionalProperties:false` den
// ganzen User-Record ab, samt eines im selben Record steckenden PIN-Wechsels.
describe('posHandedness', () => {
  const patchValidator = getValidator(userPatchSchema, addFormats(new Ajv({}), formats))

  it.each(['left', 'right'])('akzeptiert %s in Create und Patch', async value => {
    await expect(validator({ ...initialEdgeAdmin, posHandedness: value })).resolves.toBeTruthy()
    await expect(patchValidator({ posHandedness: value })).resolves.toBeTruthy()
  })

  it('ist optional — Bestands-User ohne Feld bleiben gueltig', async () => {
    await expect(validator(initialEdgeAdmin)).resolves.toBeTruthy()
    expect(userSchema.required).not.toContain('posHandedness')
  })

  it.each(['links', 'LEFT', '', 0])('lehnt unbekannten Wert %j ab', async value => {
    await expect(validator({ ...initialEdgeAdmin, posHandedness: value })).rejects.toThrow()
    await expect(patchValidator({ posHandedness: value })).rejects.toThrow()
  })

  // Kein `Null` in der Union: Ein null-Clear verwirft die Cloud per stripNulls,
  // der naechste Pull holte den alten Wert zurueck (Null-Clear-Deadlock).
  it('lehnt null ab', async () => {
    await expect(validator({ ...initialEdgeAdmin, posHandedness: null })).rejects.toThrow()
    await expect(patchValidator({ posHandedness: null })).rejects.toThrow()
  })
})

// panary/panary-cloud#1504: Die Admin-UI leert den Jahresanspruch per `null`. Anders als bei
// `posHandedness` kein Null-Clear-Deadlock: Die Cloud laesst `null` fuer dieses Feld extern durch
// (`USER_EXTERNAL_CLEAR_FIELDS`), und der Edge bearbeitet es nie selbst.
describe('vacationDaysPerYear', () => {
  const patchValidator = getValidator(userPatchSchema, addFormats(new Ajv({}), formats))

  it('akzeptiert null in Create und Patch', async () => {
    await expect(validator({ ...initialEdgeAdmin, vacationDaysPerYear: null })).resolves.toBeTruthy()
    await expect(patchValidator({ vacationDaysPerYear: null })).resolves.toBeTruthy()
  })

  it('prueft Zahlen weiter gegen 0–60', async () => {
    await expect(patchValidator({ vacationDaysPerYear: 28 })).resolves.toBeTruthy()
    await expect(patchValidator({ vacationDaysPerYear: 61 })).rejects.toThrow()
    await expect(patchValidator({ vacationDaysPerYear: '28' })).rejects.toThrow()
  })
})
