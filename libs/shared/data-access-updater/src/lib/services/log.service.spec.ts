import { afterEach, describe, expect, it, vi } from 'vitest'
import { LogService } from './log.service'

function stubTauri() {
  const invoke = vi.fn<(cmd: string, args?: Record<string, unknown>) => Promise<void>>(() => Promise.resolve())
  vi.stubGlobal('window', { __TAURI_INTERNALS__: {}, __TAURI__: { core: { invoke } }, addEventListener: vi.fn() })
  return invoke
}

describe('LogService.installGlobalCapture', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('spiegelt console.info als info in die native Logdatei', () => {
    const invoke = stubTauri()
    const original = console.info
    const service = new LogService()
    try {
      service.installGlobalCapture()
      console.info('[PosSessionService] Mitarbeiter-Sitzung beendet. Grund:', 'idle')
    } finally {
      console.info = original
    }

    expect(invoke).toHaveBeenCalledWith('js_log', {
      level: 'info',
      message: '[PosSessionService] Mitarbeiter-Sitzung beendet. Grund: idle',
    })
  })
})
