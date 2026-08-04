import { beforeEach, describe, expect, it, vi } from 'vitest'

// Die Worker-Module ziehen die halbe App (Feathers, Knex, socket.io) — hier
// interessiert nur die Weiche, also werden die drei Ziele gemockt.
// `vi.hoisted`, weil `vi.mock` über die Variablendeklarationen gehoistet wird.
const mocks = vi.hoisted(() => ({
  pullBusinessDaysOnce: vi.fn(async () => 0),
  pullMasterDataServiceOnce: vi.fn(async () => 0),
  pullPrinterCommandsOnce: vi.fn(async () => undefined),
}))
const { pullBusinessDaysOnce, pullMasterDataServiceOnce, pullPrinterCommandsOnce } = mocks

vi.mock('./cloud-pull-business-days.worker', () => ({ pullBusinessDaysOnce: mocks.pullBusinessDaysOnce }))
vi.mock('./cloud-sync-scheduler.worker', () => ({
  pullMasterDataServiceOnce: mocks.pullMasterDataServiceOnce,
  pullPrinterCommandsOnce: mocks.pullPrinterCommandsOnce,
  getActiveConnection: vi.fn(async () => null),
  triggerImmediateCycle: vi.fn(async () => undefined),
}))
vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))
vi.mock('./cloud-realtime-state', () => ({ setRealtimeConnected: vi.fn() }))
vi.mock('../utils/cloud-token-cipher', () => ({ decryptCloudToken: vi.fn() }))

import { runServicePull } from './cloud-realtime.worker'

const app = {} as never

beforeEach(() => {
  pullBusinessDaysOnce.mockClear()
  pullMasterDataServiceOnce.mockClear()
  pullPrinterCommandsOnce.mockClear()
})

describe('runServicePull — Weiche für das Cloud-`changed`-Event', () => {
  it('holt printer-commands über die Kommando-Queue, NICHT über den Stammdaten-Pull', async () => {
    // Kern der Regression: `printer-commands` steht nicht in der
    // `SyncableMasterDataService`-Allowlist. Im Stammdaten-Zweig liefe der Pull
    // gegen `/sync-pull?service=printer-commands` und bekaeme einen Fehler
    // statt des Testdruck-Jobs.
    await runServicePull(app, 'printer-commands')

    expect(pullPrinterCommandsOnce).toHaveBeenCalledOnce()
    expect(pullMasterDataServiceOnce).not.toHaveBeenCalled()
    expect(pullBusinessDaysOnce).not.toHaveBeenCalled()
  })

  it('holt businessdays über den dedizierten Worker', async () => {
    await runServicePull(app, 'businessdays')

    expect(pullBusinessDaysOnce).toHaveBeenCalledOnce()
    expect(pullMasterDataServiceOnce).not.toHaveBeenCalled()
  })

  it('routet Stammdaten unveraendert auf den cursor-basierten Pull', async () => {
    await runServicePull(app, 'products')

    expect(pullMasterDataServiceOnce).toHaveBeenCalledWith(app, 'products')
    expect(pullPrinterCommandsOnce).not.toHaveBeenCalled()
  })
})
