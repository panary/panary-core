import { describe, expect, it, vi } from 'vitest'

import { ConnectOutageLog, OUTAGE_REMINDER_MS } from './connect-outage-log'

const setup = () => {
  let t = 1_000_000
  const sink = { warn: vi.fn(), info: vi.fn() }
  const log = new ConnectOutageLog(sink, () => t)
  return { sink, log, advance: (ms: number) => (t += ms) }
}

describe('ConnectOutageLog', () => {
  it('schreibt 100 gleiche Fehler hintereinander genau einmal', () => {
    const { sink, log, advance } = setup()
    for (let i = 0; i < 100; i++) {
      log.connectError(new Error('websocket error'))
      advance(5000)
    }
    expect(sink.warn).toHaveBeenCalledTimes(1)
    expect(sink.warn).toHaveBeenCalledWith('[WS] Verbindung fehlgeschlagen: Error: websocket error')
    expect(sink.info).not.toHaveBeenCalled()
  })

  it('fasst beim Wiederverbinden mit Dauer und Versuchen zusammen', () => {
    const { sink, log, advance } = setup()
    for (let i = 0; i < 12; i++) {
      log.connectError(new Error('websocket error'))
      advance(5000)
    }
    log.connected()
    expect(sink.info).toHaveBeenCalledTimes(1)
    expect(sink.info).toHaveBeenCalledWith('[WS] Wieder verbunden nach 60 s und 12 Versuchen')
  })

  it('schreibt nichts, wenn ohne vorherigen Fehler verbunden wird', () => {
    const { sink, log } = setup()
    log.connected()
    expect(sink.info).not.toHaveBeenCalled()
  })

  it('meldet einen neuen Ausfall nach dem Wiederverbinden wieder', () => {
    const { sink, log } = setup()
    log.connectError(new Error('websocket error'))
    log.connected()
    log.connectError(new Error('websocket error'))
    expect(sink.warn).toHaveBeenCalledTimes(2)
  })

  it('schreibt bei geänderter Meldung erneut', () => {
    const { sink, log } = setup()
    log.connectError(new Error('websocket error'))
    log.connectError(new Error('xhr poll error'))
    log.connectError(new Error('xhr poll error'))
    expect(sink.warn).toHaveBeenCalledTimes(2)
  })

  it('erinnert höchstens alle 10 Minuten', () => {
    const { sink, log, advance } = setup()
    log.connectError(new Error('websocket error'))
    advance(OUTAGE_REMINDER_MS - 1)
    log.connectError(new Error('websocket error'))
    expect(sink.warn).toHaveBeenCalledTimes(1)
    advance(1)
    log.connectError(new Error('websocket error'))
    expect(sink.warn).toHaveBeenCalledTimes(2)
    expect(sink.warn).toHaveBeenLastCalledWith(
      '[WS] Server weiter nicht erreichbar seit 10 min (3 Versuche): Error: websocket error',
    )
    log.connectError(new Error('websocket error'))
    expect(sink.warn).toHaveBeenCalledTimes(2)
  })

  it('schreibt keinen Stack und kein data', () => {
    const { sink, log } = setup()
    log.connectError(Object.assign(new Error('boom'), { data: { secret: 'x' }, stack: 'at secret.ts:1' }))
    expect(sink.warn.mock.calls[0][0]).toBe('[WS] Verbindung fehlgeschlagen: Error: boom')
  })
})
