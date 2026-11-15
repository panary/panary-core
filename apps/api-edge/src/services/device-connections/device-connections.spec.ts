import { describe, expect, it } from 'vitest'

import type { Application } from '../../declarations'
import { collectConnectedDevices, deviceConnectionsService } from './device-connections'

interface FakeConnection {
  tenantId?: string
  deviceId?: string
  clientVersion?: unknown
}

/** Die Channel-Registry des Edge, auf das reduziert, was der Service liest. */
const makeApp = (connections: FakeConnection[], devicesTotal = 5) =>
  ({
    channel: () => ({ connections }),
    service: () => ({ find: async () => ({ total: devicesTotal }) }),
  }) as unknown as Application

const TENANT = 'tenant-a'

describe('collectConnectedDevices', () => {
  it('nennt je verbundenem Gerät seine Client-Version', () => {
    const app = makeApp([
      { tenantId: TENANT, deviceId: 'pos-1', clientVersion: '26.11.15' },
      { tenantId: TENANT, deviceId: 'kds-1', clientVersion: '26.10.3' },
    ])
    expect(collectConnectedDevices(app, TENANT)).toEqual([
      { deviceId: 'pos-1', clientVersion: '26.11.15' },
      { deviceId: 'kds-1', clientVersion: '26.10.3' },
    ])
  })

  it('führt ein Gerät ohne Version als unbekannt (null), nie als fehlend', () => {
    const app = makeApp([{ tenantId: TENANT, deviceId: 'pos-old' }])
    expect(collectConnectedDevices(app, TENANT)).toEqual([{ deviceId: 'pos-old', clientVersion: null }])
  })

  it('liest einen unbrauchbaren Wert an der Connection als unbekannt', () => {
    const app = makeApp([{ tenantId: TENANT, deviceId: 'pos-1', clientVersion: 'x'.repeat(200) }])
    expect(collectConnectedDevices(app, TENANT)).toEqual([{ deviceId: 'pos-1', clientVersion: null }])
  })

  it('zeigt nur Geräte des angefragten Tenants', () => {
    const app = makeApp([
      { tenantId: TENANT, deviceId: 'pos-1', clientVersion: '26.11.15' },
      { tenantId: 'tenant-b', deviceId: 'pos-fremd', clientVersion: '26.11.15' },
    ])
    expect(collectConnectedDevices(app, TENANT).map(d => d.deviceId)).toEqual(['pos-1'])
  })

  it('zählt ein Gerät mit zwei Verbindungen einmal und behält die bekannte Version', () => {
    // Reconnect-Überlappung: Die alte, versionslose Verbindung hängt noch in der Registry.
    const app = makeApp([
      { tenantId: TENANT, deviceId: 'pos-1' },
      { tenantId: TENANT, deviceId: 'pos-1', clientVersion: '26.11.15' },
    ])
    expect(collectConnectedDevices(app, TENANT)).toEqual([{ deviceId: 'pos-1', clientVersion: '26.11.15' }])
  })

  it('überschreibt eine bekannte Version nicht durch eine versionslose Verbindung', () => {
    const app = makeApp([
      { tenantId: TENANT, deviceId: 'pos-1', clientVersion: '26.11.15' },
      { tenantId: TENANT, deviceId: 'pos-1' },
    ])
    expect(collectConnectedDevices(app, TENANT)).toEqual([{ deviceId: 'pos-1', clientVersion: '26.11.15' }])
  })

  it('nimmt bei zwei bekannten Versionen die der zuletzt registrierten Verbindung', () => {
    // Update am Gerät: Die alte Verbindung hängt noch in der Registry, die neue steht dahinter.
    const app = makeApp([
      { tenantId: TENANT, deviceId: 'pos-1', clientVersion: '26.10.3' },
      { tenantId: TENANT, deviceId: 'pos-1', clientVersion: '26.11.15' },
    ])
    expect(collectConnectedDevices(app, TENANT)).toEqual([{ deviceId: 'pos-1', clientVersion: '26.11.15' }])
  })

  it('übergeht Connections ohne deviceId', () => {
    const app = makeApp([{ tenantId: TENANT, clientVersion: '26.11.15' }])
    expect(collectConnectedDevices(app, TENANT)).toEqual([])
  })
})

describe('deviceConnectionsService.find', () => {
  it('liefert connectedDevices neben den bisherigen Feldern', async () => {
    const app = makeApp([{ tenantId: TENANT, deviceId: 'pos-1', clientVersion: '26.11.15' }], 3)
    const res = await deviceConnectionsService(app).find({ user: { tenantId: TENANT }, provider: 'socketio' })
    expect(res).toEqual({
      online: 1,
      total: 3,
      connectedDeviceIds: ['pos-1'],
      connectedDevices: [{ deviceId: 'pos-1', clientVersion: '26.11.15' }],
    })
  })

  it('liefert ohne Tenant intern leere Listen, extern verweigert er', async () => {
    const service = deviceConnectionsService(makeApp([]))
    await expect(service.find({})).resolves.toEqual({
      online: 0,
      total: 0,
      connectedDeviceIds: [],
      connectedDevices: [],
    })
    await expect(service.find({ provider: 'socketio' })).rejects.toThrow()
  })
})
