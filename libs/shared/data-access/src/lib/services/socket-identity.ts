/**
 * Identitaet, mit der ein socket.io-Socket tatsaechlich gebaut wurde.
 *
 * `deviceId` ist `null`, wenn der Socket im Admin-/User-Modus entstanden ist
 * (dann kommt die URL aus `APP_CONFIG`, nicht aus der DeviceConfig).
 */
export interface SocketIdentity {
  deviceId: string | null
  baseUrl: string
}

/**
 * Protokoll + Host einer URL — Spiegel von `ConnectionService.getBaseUrl()`,
 * damit hier und dort derselbe Wert verglichen wird.
 */
const toBaseUrl = (url: string): string => {
  try {
    const parsed = new URL(url)
    return `${parsed.protocol}//${parsed.host}`
  } catch {
    return url
  }
}

/**
 * Passt eine DeviceConfig noch zu einem bereits gebauten Socket?
 *
 * socket.io friert URL und `auth`-Payload beim Erzeugen ein. Weicht die
 * gespeicherte Config davon ab (frisch gepairt, Server gewechselt, entkoppelt),
 * ist der laufende Socket dauerhaft falsch konfiguriert — ein Reconnect heilt
 * das nicht, nur ein App-Neustart. Konsumenten erkennen den Fall hier, statt
 * aussichtslos weiter zu verbinden.
 */
export const matchesSocketIdentity = (
  identity: SocketIdentity,
  config: { deviceId?: string | null; serverUrl?: string | null } | null | undefined,
): boolean => {
  const deviceId = config?.deviceId ?? null
  if (deviceId !== identity.deviceId) return false
  // Beidseitig Admin-/User-Modus: die URL stammt aus APP_CONFIG und kann sich
  // durch eine Config-Aenderung gar nicht verschoben haben.
  if (!deviceId) return true
  return toBaseUrl(config?.serverUrl ?? '') === identity.baseUrl
}
