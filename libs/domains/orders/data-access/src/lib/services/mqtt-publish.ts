import mqtt from 'mqtt'

export interface MqttPrintPayload {
  orderId: string
  deviceName?: string
  printerIds: string[]
}

interface MqttBrokerConfig {
  protocol: string
  host: string
  port: number
}

/** Signatur von `window.__TAURI__.core.invoke` — siehe `resolveTauriInvoke`. */
type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

const PUBLISH_TIMEOUT_MS = 5000

/**
 * Baut die Broker-URL. Einziger Bauort fuer **beide** Wege (Tauri und Browser) —
 * zwei waeren zwei Gelegenheiten, dass Rueckfall und Regelweg auf verschiedene
 * Adressen zeigen.
 *
 * Pfad `/mqtt` ist Standard fuer MQTT-over-WebSocket (Mosquitto, EMQX, HiveMQ).
 */
export function buildBrokerUrl(broker: MqttBrokerConfig): string {
  return `${broker.protocol}://${broker.host}:${broker.port}/mqtt`
}

/**
 * `window.__TAURI__.core.invoke`, sofern die App im Tauri-Shell laeuft.
 *
 * `withGlobalTauri: true` (tauri.conf.json) stellt das Objekt bereit — so
 * vermeiden wir eine zusaetzliche `@tauri-apps/api`-Abhaengigkeit nur fuer den
 * Aufruf (gleiches Muster wie `LogService` und `HubDiscoveryService`).
 */
function resolveTauriInvoke(): TauriInvoke | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { __TAURI__?: { core?: { invoke?: TauriInvoke } } }
  return w?.__TAURI__?.core?.invoke ?? null
}

/**
 * Fire-and-Forget MQTT-Publish: verbindet sich zum Broker, sendet die Nachricht
 * und trennt sofort. Keine dauerhafte Verbindung noetig, da die POS-App keine
 * Topics abonniert.
 *
 * **Zwei Wege, bewusst:**
 * - Im gepackten POS laeuft der Publish ueber den Tauri-Command `mqtt_publish`
 *   im Rust-Prozess. Der Webview-Weg unterliegt der statischen
 *   `connect-src`-Direktive, waehrend die Broker-Adresse Betreiber-Konfiguration
 *   ist (Port 1-65535) — daran ist der Pfad in #296 gescheitert. Begruendung:
 *   ADR 0036.
 * - Ohne Tauri (Browser, `nx serve`, Edge-Admin) bleibt `mqtt.js` ueber
 *   WebSocket. Ohne diesen Rueckfall verloere genau die Umgebung den MQTT-Druck,
 *   in der er sich testen laesst.
 */
export async function publishViaMqtt(
  payload: MqttPrintPayload,
  topic: string,
  broker: MqttBrokerConfig,
  clientId?: string,
): Promise<void> {
  const url = buildBrokerUrl(broker)
  const id = clientId || `panary-pos-${Date.now()}`
  const body = JSON.stringify(payload)

  const invoke = resolveTauriInvoke()
  if (invoke) {
    await publishViaTauri(invoke, url, topic, body, id)
    return
  }
  await publishViaWebSocket(url, topic, body, id)
}

/** Rust-Prozess (gepackter POS) — keine CSP im Weg. */
async function publishViaTauri(
  invoke: TauriInvoke,
  url: string,
  topic: string,
  payload: string,
  clientId: string,
): Promise<void> {
  await invoke('mqtt_publish', { url, topic, payload, clientId, timeoutMs: PUBLISH_TIMEOUT_MS })
}

/** Rueckfall fuer Browser und `nx serve` — `mqtt.js` ueber WebSocket. */
function publishViaWebSocket(url: string, topic: string, payload: string, clientId: string): Promise<void> {
  const client = mqtt.connect(url, {
    clean: true,
    connectTimeout: PUBLISH_TIMEOUT_MS,
    clientId,
  })

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.end(true)
      reject(new Error('MQTT-Verbindung Timeout'))
    }, PUBLISH_TIMEOUT_MS)

    client.on('connect', () => {
      client.publish(topic, payload, {}, err => {
        clearTimeout(timeout)
        client.end()
        if (err) {
          reject(err)
        } else {
          resolve()
        }
      })
    })

    client.on('error', err => {
      clearTimeout(timeout)
      client.end(true)
      reject(err)
    })
  })
}
