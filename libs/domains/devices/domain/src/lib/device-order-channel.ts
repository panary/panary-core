// Standard-Bestellart je Terminal (panary/panary-core#1166): Ein Terminal mit fester
// Aufgabe (nur Telefon, nur Theke) startet neue Bestellungen im eingestellten Kanal.
// Der Umschalter im Bestelldialog überschreibt weiterhin je Bestellung.
//
// Framework-agnostisch (kein Feathers, kein Angular) und ohne Import aus
// @panary/orders/domain bzw. @panary/users/domain: die devices-Domain hängt sonst im
// Publish-Build an beiden (Cross-Lib-Wiring). Die Werte spiegeln `OrderChannel`
// (POS, TELEPHONE); der Invarianten-Test in device-order-channel.spec.ts lockt das.
// Muster und Begründung wie device-access-mode.ts.

/** Kanäle, die ein Terminal als Standard tragen kann. `online`/`app` entstehen nicht am Terminal. */
export const DeviceOrderChannel = {
  POS: 'pos',
  TELEPHONE: 'telephone',
} as const
export type DeviceOrderChannelValue = (typeof DeviceOrderChannel)[keyof typeof DeviceOrderChannel]

/**
 * Rollen, die die Standard-Bestellart setzen dürfen. Bewusst eng (Entscheidung Michael):
 * kein Filialleiter, kein Techniker (der behält `devices: MANAGE`, nur dieses Feld ist
 * für ihn gesperrt), kein `platform:admin`/`platform:support`.
 */
export const DEVICE_ORDER_CHANNEL_WRITE_ROLES: ReadonlySet<string> = new Set<string>(['platform:owner', 'tenant:owner'])

export const DEVICE_ORDER_CHANNEL_FIELD = 'defaultOrderChannel'

export interface DeviceOrderChannelViolation {
  reason: 'FORBIDDEN_ROLE' | 'INVALID_CHANNEL'
  /** Client-stabile Meldung — Adapter werfen sie unverändert als Forbidden/BadRequest. */
  message: string
}

export interface DeviceOrderChannelActor {
  role?: string
  /** true bei internen Aufrufen (`provider: undefined`) — Rollen-Gate entfällt. */
  internal?: boolean
}

/** true, wenn der Schreib-Body das Feld überhaupt berührt (auch mit `null` oder `undefined`). */
export const touchesDeviceOrderChannel = (data: unknown): boolean =>
  !!data && typeof data === 'object' && DEVICE_ORDER_CHANNEL_FIELD in (data as Record<string, unknown>)

/**
 * Normalisiert den gespeicherten Wert. Alles außer den beiden Literalen (auch `null`,
 * Tippfehler, unbekannte Zukunftswerte) ergibt `null` = „kein Standard": ein unlesbarer
 * Wert darf die Bestellung nicht in den falschen Kanal zwingen. Die strikte Prüfung
 * sitzt auf dem Schreibpfad (`checkDeviceOrderChannelWrite`).
 */
export const resolveDeviceOrderChannel = (
  device: { defaultOrderChannel?: unknown } | null | undefined,
): DeviceOrderChannelValue | null => {
  const value = device?.defaultOrderChannel
  return value === DeviceOrderChannel.POS || value === DeviceOrderChannel.TELEPHONE ? value : null
}

/**
 * Prüft einen `create`/`patch`-Body auf `defaultOrderChannel`. Liefert `null`, wenn der
 * Write erlaubt ist (oder das Feld gar nicht berührt), sonst die Verletzung.
 *
 * Das Rollen-Gate gilt für JEDEN externen Zugriff auf das Feld, auch für `null`
 * (Zurücksetzen) und `undefined`: sonst wäre das Löschen ein Umweg um das Setzen.
 * Interne Aufrufe (`provider: undefined`, z. B. Pairing-Redeem) sind wie in
 * `checkDeviceAssignmentWrite` ausgenommen.
 */
export const checkDeviceOrderChannelWrite = (
  actor: DeviceOrderChannelActor | undefined,
  data: unknown,
): DeviceOrderChannelViolation | null => {
  if (!touchesDeviceOrderChannel(data)) return null

  if (!actor?.internal && !(actor?.role && DEVICE_ORDER_CHANNEL_WRITE_ROLES.has(actor.role))) {
    return {
      reason: 'FORBIDDEN_ROLE',
      message: 'Die Standard-Bestellart eines Geraets kann nur vom Inhaber geaendert werden.',
    }
  }

  const value = (data as Record<string, unknown>)[DEVICE_ORDER_CHANNEL_FIELD]
  if (
    value !== null &&
    value !== undefined &&
    value !== DeviceOrderChannel.POS &&
    value !== DeviceOrderChannel.TELEPHONE
  ) {
    return {
      reason: 'INVALID_CHANNEL',
      message: `Unbekannte Bestellart. Erlaubt: ${Object.values(DeviceOrderChannel).join(', ')} oder null.`,
    }
  }

  return null
}
