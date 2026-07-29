import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@panary/cloud-connection/domain', () => ({
  PairingStatus: { CONNECTED: 'connected', DISCONNECTED: 'disconnected', PENDING: 'pending' },
}))

import { findConnectedCloudConnection, findReportableCloudConnection } from './cloud-connection-lookup'

/**
 * `find` filtert die Query nach — nur so kann die Spec zeigen, dass die Helper
 * gezielt auswaehlen statt die erste beliebige Zeile zu nehmen.
 */
function makeApp(rows: Array<{ pairingStatus: string; _id?: string }>, opts: { throws?: boolean } = {}): any {
  return {
    service: () => ({
      find: opts.throws
        ? vi.fn().mockRejectedValue(new Error('service not registered'))
        : vi
            .fn()
            .mockImplementation(({ query }: any) =>
              Promise.resolve(query?.pairingStatus ? rows.filter(r => r.pairingStatus === query.pairingStatus) : rows),
            ),
    }),
  }
}

beforeEach(() => vi.clearAllMocks())

describe('findConnectedCloudConnection', () => {
  it('liefert die CONNECTED-Zeile, auch wenn Altlasten davor stehen', async () => {
    const app = makeApp([
      { _id: 'alt', pairingStatus: 'disconnected' },
      { _id: 'aktiv', pairingStatus: 'connected' },
    ])

    expect((await findConnectedCloudConnection(app))?._id).toBe('aktiv')
  })

  it('liefert null, wenn keine Verbindung aktiv ist', async () => {
    const app = makeApp([{ _id: 'alt', pairingStatus: 'disconnected' }])

    expect(await findConnectedCloudConnection(app)).toBeNull()
  })

  // Beim allerersten Boot ist der Service noch nicht registriert.
  it('faellt bei Lookup-Fehler offen auf null zurueck', async () => {
    expect(await findConnectedCloudConnection(makeApp([], { throws: true }))).toBeNull()
  })
})

describe('findReportableCloudConnection', () => {
  it('bevorzugt die CONNECTED-Zeile gegenueber einer Altlast', async () => {
    const app = makeApp([
      { _id: 'alt', pairingStatus: 'disconnected' },
      { _id: 'aktiv', pairingStatus: 'connected' },
    ])

    expect((await findReportableCloudConnection(app))?._id).toBe('aktiv')
  })

  // Wichtig fuer die Re-Pairing-Warnung: ein Edge, dessen Token die Cloud
  // abgelehnt hat, hat gar keine CONNECTED-Zeile mehr und muss seinen Zustand
  // trotzdem melden koennen.
  it('faellt auf eine nicht-verbundene Zeile zurueck, wenn keine aktiv ist', async () => {
    const app = makeApp([{ _id: 'alt', pairingStatus: 'disconnected' }])

    expect((await findReportableCloudConnection(app))?.pairingStatus).toBe('disconnected')
  })

  it('liefert null ohne jede Zeile', async () => {
    expect(await findReportableCloudConnection(makeApp([]))).toBeNull()
  })

  it('faellt bei Lookup-Fehler offen auf null zurueck', async () => {
    expect(await findReportableCloudConnection(makeApp([], { throws: true }))).toBeNull()
  })
})
