/** Was der POS vom Gerät kennt und im Handshake beglaubigt. */
export interface DeviceSocketAuthConfig {
  apiKey: string
  deviceId: string
  deviceName?: string | null
}

/**
 * Der `auth`-Payload des Geräte-Sockets (POS, KDS, Tablet, Kiosk).
 *
 * `clientVersion` ist der Stand dieses Builds (core#1438, ADR 0070). Der Edge nimmt ihn tolerant an;
 * ein Edge, der das Feld nicht kennt, ignoriert ihn, und das Gerät verbindet unverändert. Ein leerer
 * Wert wird nicht gesendet: „keine Angabe" ist für den Edge dasselbe wie „unbekannt".
 */
export function buildDeviceSocketAuth(config: DeviceSocketAuthConfig, appVersion: string | null | undefined) {
  const clientVersion = typeof appVersion === 'string' ? appVersion.trim() : ''
  return {
    apiKey: config.apiKey,
    deviceId: config.deviceId,
    deviceName: config.deviceName || `POS-${config.deviceId.substring(0, 8)}`,
    ...(clientVersion ? { clientVersion } : {}),
  }
}
