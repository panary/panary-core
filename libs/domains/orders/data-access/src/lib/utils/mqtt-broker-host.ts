import { Utils } from '@panary/shared/util-helpers'

export interface MqttBrokerHostSources {
  /** `mqttServerUrl` aus den Print-Settings der Location. */
  configuredHost?: string | null
  /** Basis-URL des gepairten Edge — Ergebnis von `resolveEdgeBaseUrl`. */
  edgeBaseUrl?: string | null
}

/**
 * Hosts, die aus Sicht des POS auf ihn selbst zeigen. Der Default der
 * Print-Settings ist `localhost` (siehe `generateDefaultLocationSettings`) —
 * gemeint war damit „der Rechner, auf dem alles laeuft", was nur zutrifft,
 * solange POS und Broker dieselbe Maschine sind. Auf einem Sunmi-Tablet ist
 * `localhost` das Tablet, und der Druckauftrag verschwindet spurlos: der
 * Publish laeuft in einen Verbindungsfehler, den niemand sieht.
 */
const SELF_REFERENTIAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]'])

/**
 * Ermittelt den Host des MQTT-Brokers fuer den Druck-Publish.
 *
 * Seit der Broker Teil des Edge-Deployments ist (`panary-mqtt` neben dem Edge,
 * siehe `tools/hosting/get.panary.cloud/install.sh`), laeuft er per Definition
 * auf demselben Rechner wie der Edge. Ein nicht gepflegter oder auf sich selbst
 * zeigender Eintrag kann deshalb still auf den gepairten Edge-Host zurueckfallen,
 * statt den Auftrag ins Leere laufen zu lassen.
 *
 * Bewusst *nur* der Host: Protokoll und Port bleiben Sache der Settings, damit
 * eine abweichende Broker-Installation (anderer Port, `wss`) konfigurierbar
 * bleibt. Ein explizit gesetzter, nicht selbstbezueglicher Host gewinnt immer.
 *
 * @returns den Broker-Host oder `null`, wenn keine Quelle etwas hergibt — der
 * Aufrufer ueberspringt den MQTT-Druck dann so, wie er es ohne Konfiguration
 * auch bisher getan hat.
 */
export function resolveMqttBrokerHost(sources: MqttBrokerHostSources): string | null {
  const configured = sources.configuredHost?.trim()
  if (configured && !SELF_REFERENTIAL_HOSTS.has(stripHost(configured).toLowerCase())) {
    return stripHost(configured)
  }

  const edgeBase = sources.edgeBaseUrl?.trim()
  if (!edgeBase) return null

  try {
    // `Utils.getBaseUrl` normalisiert auf `protocol//host`; fuer MQTT zaehlt
    // nur der Hostname — der Edge-Port (3030) ist nicht der Broker-Port.
    return new URL(Utils.getBaseUrl(edgeBase)).hostname || null
  } catch {
    return null
  }
}

/**
 * Nimmt Eintraege wie `ws://10.0.0.5:9001` oder `10.0.0.5:1883` entgegen und
 * gibt den reinen Host zurueck. Historisch wurde das Feld mal mit Protokoll,
 * mal ohne gepflegt; `mqtt.connect` baut die URL aber selbst zusammen und
 * erzeugt bei einem Protokoll-Praefix im Host eine kaputte Adresse.
 */
function stripHost(raw: string): string {
  const withoutProtocol = raw.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
  const withoutPath = withoutProtocol.split('/')[0]
  // IPv6 in Klammern behaelt seine Doppelpunkte.
  if (withoutPath.startsWith('[')) return withoutPath.split(']')[0] + ']'
  // Blanke IPv6-Adresse (`::1`, `fd00::1`): ein Port laesst sich ohne Klammern
  // gar nicht ausdruecken, also gehoert jeder Doppelpunkt zur Adresse. Ohne
  // diesen Zweig schnitte die Port-Trennung unten die Adresse auf `''` zurecht.
  if (withoutPath.indexOf(':') !== withoutPath.lastIndexOf(':')) return withoutPath
  // Sonst ist alles ab dem Doppelpunkt der Port und gehoert nicht in den Host.
  return withoutPath.split(':')[0]
}
