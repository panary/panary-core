import { describe, expect, it, onTestFinished, vi } from 'vitest'
import { buildBrokerUrl, publishViaMqtt } from './mqtt-publish'

/**
 * Die `vi.mock`-Factory ist zwangslaeufig Modul-Scope (Hoisting). Sie delegiert
 * deshalb an einen Handler, den JEDER Test selbst setzt und am Ende wieder
 * entfernt — ein geteiltes Aufzeichnungsobjekt gibt es damit nicht
 * (`.claude/rules/code-style.md` §10). Ein Nachzuegler aus einem beendeten Test
 * laeuft in den Wurf unten, statt still in die Daten des naechsten zu schreiben.
 */
const mqttMock = vi.hoisted(() => ({
  handler: null as null | ((url: string, options: Record<string, unknown>) => unknown),
}))

vi.mock('mqtt', () => ({
  default: {
    connect: (url: string, options: Record<string, unknown>) => {
      if (!mqttMock.handler) throw new Error(`mqtt.connect unerwartet aufgerufen: ${url}`)
      return mqttMock.handler(url, options)
    },
  },
}))

interface WsRecorder {
  urls: string[]
  options: Record<string, unknown>[]
  publishes: { topic: string; payload: string }[]
  ended: boolean
}

/** Minimaler `mqtt.js`-Client, der sofort verbindet und jeden Publish bestaetigt. */
function installWebSocketFake(): WsRecorder {
  const rec: WsRecorder = { urls: [], options: [], publishes: [], ended: false }
  mqttMock.handler = (url, options) => {
    rec.urls.push(url)
    rec.options.push(options)
    const handlers: Record<string, (...args: unknown[]) => void> = {}
    return {
      on(event: string, cb: (...args: unknown[]) => void) {
        handlers[event] = cb
        if (event === 'connect') queueMicrotask(() => cb())
      },
      publish(topic: string, payload: string, _opts: unknown, cb: (err?: Error) => void) {
        rec.publishes.push({ topic, payload })
        cb()
      },
      end() {
        rec.ended = true
      },
    }
  }
  onTestFinished(() => {
    mqttMock.handler = null
  })
  return rec
}

/** Setzt `window.__TAURI__.core.invoke` fuer die Dauer eines Tests. */
function installTauri(invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>) {
  const g = globalThis as unknown as { window?: unknown }
  const had = 'window' in g
  const previous = g.window
  g.window = { __TAURI__: { core: { invoke } } }
  onTestFinished(() => {
    if (had) g.window = previous
    else delete g.window
  })
}

const payload = { orderId: 'order-1', deviceName: 'Kasse 1', printerIds: [] }

describe('buildBrokerUrl', () => {
  it('haengt den Standardpfad /mqtt an', () => {
    expect(buildBrokerUrl({ protocol: 'ws', host: '10.0.0.5', port: 9001 })).toBe('ws://10.0.0.5:9001/mqtt')
  })

  it('uebernimmt ein abweichendes Protokoll und einen abweichenden Port', () => {
    expect(buildBrokerUrl({ protocol: 'wss', host: 'broker.example', port: 8084 })).toBe(
      'wss://broker.example:8084/mqtt',
    )
  })
})

describe('publishViaMqtt', () => {
  it('nutzt im Tauri-Shell den Rust-Command und fasst mqtt.js NICHT an', async () => {
    // Kein Handler gesetzt: ein Griff nach mqtt.js wuerde werfen und diesen Test
    // rot faerben. Genau das ist der Regressionsschutz — die CSP deckt den
    // Broker-Port im gepackten Build nicht mehr ab (ADR 0036).
    const calls: { cmd: string; args?: Record<string, unknown> }[] = []
    installTauri(async (cmd, args) => {
      calls.push({ cmd, args })
      return undefined
    })

    await publishViaMqtt(payload, 'panary/print/theke', { protocol: 'ws', host: '10.0.0.5', port: 9001 }, 'dev-7')

    expect(calls).toHaveLength(1)
    expect(calls[0].cmd).toBe('mqtt_publish')
    expect(calls[0].args).toMatchObject({
      url: 'ws://10.0.0.5:9001/mqtt',
      topic: 'panary/print/theke',
      payload: JSON.stringify(payload),
      clientId: 'dev-7',
    })
  })

  it('reicht einen Fehler des Rust-Commands an den Aufrufer durch', async () => {
    installTauri(async () => {
      throw new Error('MQTT-Verbindung Timeout')
    })

    await expect(
      publishViaMqtt(payload, 'panary/print/theke', { protocol: 'ws', host: '10.0.0.5', port: 9001 }),
    ).rejects.toThrow('MQTT-Verbindung Timeout')
  })

  it('faellt ohne Tauri auf den WebSocket-Weg zurueck', async () => {
    const rec = installWebSocketFake()

    await publishViaMqtt(payload, 'panary/print/kueche', { protocol: 'ws', host: '10.0.0.5', port: 9001 }, 'dev-7')

    expect(rec.urls).toEqual(['ws://10.0.0.5:9001/mqtt'])
    expect(rec.options[0]).toMatchObject({ clientId: 'dev-7', clean: true })
    expect(rec.publishes).toEqual([{ topic: 'panary/print/kueche', payload: JSON.stringify(payload) }])
    expect(rec.ended).toBe(true)
  })

  it('erzeugt ohne uebergebene Client-Id eine eigene', async () => {
    const rec = installWebSocketFake()

    await publishViaMqtt(payload, 'panary/print/kueche', { protocol: 'ws', host: '10.0.0.5', port: 9001 })

    expect(rec.options[0]['clientId']).toMatch(/^panary-pos-\d+$/)
  })
})
