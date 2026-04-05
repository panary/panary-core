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

/**
 * Fire-and-Forget MQTT-Publish: Verbindet sich zum Broker, sendet die Nachricht und trennt sofort.
 * Keine dauerhafte Verbindung noetig, da die POS-App keine Topics abonniert.
 */
export async function publishViaMqtt(
  payload: MqttPrintPayload,
  topic: string,
  broker: MqttBrokerConfig,
  clientId?: string,
): Promise<void> {
  // Pfad /mqtt ist Standard fuer MQTT-over-WebSocket (Mosquitto, EMQX, HiveMQ)
  const url = `${broker.protocol}://${broker.host}:${broker.port}/mqtt`
  const client = mqtt.connect(url, {
    clean: true,
    connectTimeout: 5000,
    clientId: clientId || `panary-pos-${Date.now()}`,
  })

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      client.end(true)
      reject(new Error('MQTT-Verbindung Timeout'))
    }, 5000)

    client.on('connect', () => {
      client.publish(topic, JSON.stringify(payload), {}, err => {
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
