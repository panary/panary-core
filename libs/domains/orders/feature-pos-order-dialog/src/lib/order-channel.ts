import { DeviceOrderChannel, type DeviceOrderChannelValue } from '@panary/devices/domain'
import { OrderChannel } from '@panary/orders/domain'
import { LocationOperationMode } from '@panary/locations/domain'

export type PosOrderChannel = (typeof OrderChannel)[keyof typeof OrderChannel]

/**
 * Vorbelegung des Vertriebskanals nach Betriebsmodus.
 *
 * Der Dialog schrieb bis panary/panary-core#133 hart `TELEPHONE` — deshalb
 * meldete jeder Tagesabschluss „Telefon 100 %, POS 0 %", auch im Modus
 * POS-Kasse, und der `posCents`-Bucket des Aggregators war strukturell immer 0.
 *
 * `deviceChannel` ist die Standard-Bestellart des Terminals (`devices.defaultOrderChannel`); ohne sie gilt der Modus.
 *
 * Nur die Vorbelegung hängt am Modus, nicht der gebuchte Wert: Der Dialog nimmt
 * an der Kasse auch Telefonbestellungen auf. Eine feste Ableitung hätte die als
 * POS gezählt und den Fehler bloß umgedreht.
 */
export function defaultOrderChannel(
  operationMode: string | null | undefined,
  deviceChannel?: DeviceOrderChannelValue | null,
): PosOrderChannel {
  // Ein Terminal mit fester Aufgabe (core#1166) schlägt den Betriebsmodus des Standorts.
  if (deviceChannel === DeviceOrderChannel.POS) return OrderChannel.POS
  if (deviceChannel === DeviceOrderChannel.TELEPHONE) return OrderChannel.TELEPHONE
  return operationMode === LocationOperationMode.POS_CASHIER ? OrderChannel.POS : OrderChannel.TELEPHONE
}

/**
 * Umschaltung Kasse ↔ Telefon.
 *
 * Bewusst nur diese beiden Werte: `ONLINE` und `APP` entstehen nicht an der
 * Kasse, sondern in Storefront und App. Ein Umschalter mit vier Werten böte an
 * einem Touch-Gerät zwei an, die nie richtig sein können.
 */
export function toggledOrderChannel(current: PosOrderChannel): PosOrderChannel {
  return current === OrderChannel.POS ? OrderChannel.TELEPHONE : OrderChannel.POS
}
