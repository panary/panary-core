// For more information about this file see https://dove.feathersjs.com/guides/cli/service.test.html
import assert from 'assert'
import { uuidv7 } from 'uuidv7'
import { app } from '../../../src/app'

describe('apikeys service', () => {
  it('registered the service', () => {
    const service = app.service('apikeys')

    assert.ok(service, 'Registered the service')
  })
})

// REGRESSION 2026-08-01: `POST /apikeys` aus dem Admin-Panel (JWT-User) endete
// auf jedem cloud-gebootstrappten Edge mit
//   400 must have required property 'locationId'
// Der multiTenancy-Hook las `user.locationId` — ein Feld, das am Edge nur der
// virtuelle API-Key-User traegt. Menschen haben `activeLocationId`.
//
// Der Test laeuft gegen die VOLLE Hook-Kette (`provider: 'rest'` erzwingt den
// externen Pfad inkl. validateData), weil genau das Zusammenspiel aus Hook und
// Schema kaputt war — eine Unit-Spec des Hooks allein haette den 400 nicht gesehen.
//
// WICHTIG fuer die Aussagekraft: der Tenant bekommt ZWEI Filialen, und die
// `activeLocationId` des Users zeigt auf die ZWEITE. Mit nur einer Filiale
// wuerde der Location-Fallback-Lookup im Hook den fehlenden
// activeLocationId-Zweig verdecken und der Test bliebe gruen, obwohl der Bug
// wieder da ist.
describe('apikeys service — Create durch JWT-User mit activeLocationId', () => {
  const tenantId = uuidv7()

  let firstLocationId: string
  let activeLocationId: string
  let ownerUser: { _id: string; role: string; tenantId: string; activeLocationId: string }

  const createLocation = async (name: string): Promise<string> => {
    const location = (await app.service('locations').create(
      {
        name,
        tenantId,
        address: { street: 'Teststr. 1', city: 'Teststadt', postalCode: '12345', country: 'DE' },
      } as never,
      { provider: undefined },
    )) as { _id: string }
    return location._id
  }

  beforeAll(async () => {
    await app.setup()

    firstLocationId = await createLocation('Hauptfiliale apikeys')
    activeLocationId = await createLocation('Zweitfiliale apikeys')

    // Exakt die Form, die der Cloud-Pull erzeugt: activeLocationId gesetzt,
    // `locationId` gibt es im User-Schema gar nicht.
    ownerUser = { _id: uuidv7(), role: 'tenant:owner', tenantId, activeLocationId }
  })

  it('stempelt locationId aus activeLocationId — nicht aus der ersten Tenant-Location', async () => {
    const created = (await app.service('apikeys').create(
      { name: 'POS Kasse 1', description: 'Regressionstest' } as never,
      { provider: 'rest', authenticated: true, user: ownerUser } as never,
    )) as { _id: string; locationId: string; tenantId: string }

    assert.strictEqual(created.locationId, activeLocationId, 'locationId stammt aus activeLocationId')
    assert.notStrictEqual(created.locationId, firstLocationId, 'nicht der Fallback-Lookup hat gestempelt')
    assert.strictEqual(created.tenantId, tenantId)
  })

  it('explizit gesendete locationId bleibt erhalten (Owner darf die Filiale waehlen)', async () => {
    const created = (await app.service('apikeys').create(
      { name: 'POS Kasse 2', locationId: firstLocationId } as never,
      { provider: 'rest', authenticated: true, user: ownerUser } as never,
    )) as { locationId: string }

    assert.strictEqual(created.locationId, firstLocationId)
  })

  it('User ganz ohne Filiale faellt auf die erste Location des Tenants zurueck', async () => {
    const created = (await app.service('apikeys').create(
      { name: 'POS Kasse 3' } as never,
      { provider: 'rest', authenticated: true, user: { _id: uuidv7(), role: 'tenant:owner', tenantId } } as never,
    )) as { locationId: string }

    assert.strictEqual(created.locationId, firstLocationId)
  })
})
