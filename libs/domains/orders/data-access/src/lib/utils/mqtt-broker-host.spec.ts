import { describe, expect, it } from 'vitest'
import { resolveMqttBrokerHost } from './mqtt-broker-host'

// Regression: `mqttServerUrl` steht per Default auf `localhost`
// (`generateDefaultLocationSettings`). Auf einem Sunmi-Tablet zeigt das auf das
// Tablet selbst — der Publish lief in einen Verbindungsfehler, den niemand sah,
// waehrend die Einstellung „richtig ausgefuellt" aussah. Seit der Broker Teil
// des Edge-Deployments ist, gibt es ein verlaessliches Ausweichziel.

describe('resolveMqttBrokerHost', () => {
  it('nimmt einen explizit gepflegten Host', () => {
    expect(resolveMqttBrokerHost({ configuredHost: '10.10.100.90', edgeBaseUrl: 'http://10.10.100.77:3030' })).toBe(
      '10.10.100.90',
    )
  })

  it('faellt bei `localhost` auf den Host des gepairten Edge zurueck', () => {
    expect(resolveMqttBrokerHost({ configuredHost: 'localhost', edgeBaseUrl: 'http://10.10.100.77:3030' })).toBe(
      '10.10.100.77',
    )
  })

  it.each(['127.0.0.1', '0.0.0.0', '::1', 'LOCALHOST'])('behandelt %s als selbstbezueglich', host => {
    expect(resolveMqttBrokerHost({ configuredHost: host, edgeBaseUrl: 'http://edge.local:3030' })).toBe('edge.local')
  })

  it('faellt auch bei leerem Eintrag zurueck', () => {
    expect(resolveMqttBrokerHost({ configuredHost: '   ', edgeBaseUrl: 'http://edge.local:3030' })).toBe('edge.local')
  })

  it('gibt nur den Hostnamen zurueck — der Edge-Port ist nicht der Broker-Port', () => {
    expect(resolveMqttBrokerHost({ configuredHost: null, edgeBaseUrl: 'http://10.10.100.77:3030' })).toBe(
      '10.10.100.77',
    )
  })

  it('streift Protokoll und Port von einem gepflegten Eintrag ab', () => {
    // `mqtt.connect` baut die URL aus Protokoll, Host und Port selbst zusammen —
    // ein Praefix im Host-Feld ergaebe `ws://ws://…`.
    expect(resolveMqttBrokerHost({ configuredHost: 'ws://10.10.100.90:9001', edgeBaseUrl: null })).toBe('10.10.100.90')
  })

  it('haelt IPv6 in Klammern zusammen', () => {
    expect(resolveMqttBrokerHost({ configuredHost: '[fd00::1]:9001', edgeBaseUrl: null })).toBe('[fd00::1]')
  })

  it('gibt null zurueck, wenn keine Quelle etwas hergibt — der Aufrufer ueberspringt dann still', () => {
    expect(resolveMqttBrokerHost({ configuredHost: '', edgeBaseUrl: null })).toBeNull()
  })

  it('gibt null zurueck statt eine unbrauchbare Edge-URL durchzureichen', () => {
    expect(resolveMqttBrokerHost({ configuredHost: 'localhost', edgeBaseUrl: 'nicht-mal-eine-url' })).toBeNull()
  })
})
