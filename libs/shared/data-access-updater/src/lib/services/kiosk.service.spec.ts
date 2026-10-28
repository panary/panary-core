import { afterEach, describe, expect, it, vi } from 'vitest'
import { KioskService, type KioskStatus } from './kiosk.service'

const STATUS: KioskStatus = { active: true, enabled: true, paired: true, releaseBuild: true, windowMode: false }

function stubTauri() {
  const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<KioskStatus>>(() =>
    Promise.resolve(STATUS),
  )
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, __TAURI__: { core: { invoke } } })
  return invoke
}

describe('KioskService', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('tut im Browser nichts', async () => {
    vi.stubGlobal('window', {})
    const service = new KioskService()

    expect(service.isAvailable()).toBe(false)
    await service.reportPaired(true)
    await service.setEnabled(false)
    await service.enterWindowMode()
    await service.exit()

    expect(service.status()).toBeNull()
  })

  it('meldet die Kopplung an die Shell und übernimmt deren Zustand', async () => {
    const invoke = stubTauri()
    const service = new KioskService()

    await service.reportPaired(true)

    expect(invoke).toHaveBeenCalledWith('kiosk_report_paired', { paired: true })
    expect(service.status()).toEqual(STATUS)
  })

  it('ruft je Aktion genau ihren Command', async () => {
    const invoke = stubTauri()
    const service = new KioskService()

    await service.setEnabled(false)
    await service.enterWindowMode()
    await service.refresh()
    await service.exit()

    expect(invoke.mock.calls).toEqual([
      ['kiosk_set_enabled', { enabled: false }],
      ['kiosk_window_mode', undefined],
      ['kiosk_status', undefined],
      ['kiosk_exit', undefined],
    ])
  })
})
