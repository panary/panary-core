// Vertriebskanal der POS-Bestellung (panary/panary-core#133, Phase 4).
//
// Der Dialog schrieb hart `TELEPHONE`. Folge: Jeder Tagesabschluss meldete
// „Telefon 100 %, POS 0 %" — auch im Modus POS-Kasse. Eine repo-weite Suche
// fand vor diesem Commit KEINE Stelle, die `OrderChannel.POS` auf eine reale
// Bestellung setzte; der `posCents`-Bucket des Aggregators war strukturell
// immer 0, und die Kanal-Statistik damit wertlos.

import { describe, expect, it } from 'vitest'
import { OrderChannel } from '@panary/orders/domain'

import { defaultOrderChannel, toggledOrderChannel } from './order-channel'

describe('defaultOrderChannel', () => {
  it('belegt im Kassenbetrieb mit POS vor', () => {
    expect(defaultOrderChannel('pos-cashier')).toBe(OrderChannel.POS)
  })

  it('bleibt im Bestellbetrieb bei Telefon', () => {
    // `orders-only` hat keinen Kassierpfad — POS wäre dort eine Behauptung.
    expect(defaultOrderChannel('orders-only')).toBe(OrderChannel.TELEPHONE)
  })

  it('bleibt bei unbekanntem oder fehlendem Modus bei Telefon', () => {
    // Die Location kann beim Öffnen des Dialogs noch nicht geladen sein. Der
    // konservative Zweig ist Telefon: Er entspricht dem bisherigen Verhalten,
    // ein voreiliges POS würde die Statistik in die andere Richtung verfälschen.
    expect(defaultOrderChannel(undefined)).toBe(OrderChannel.TELEPHONE)
    expect(defaultOrderChannel(null)).toBe(OrderChannel.TELEPHONE)
    expect(defaultOrderChannel('')).toBe(OrderChannel.TELEPHONE)
    expect(defaultOrderChannel('etwas-neues')).toBe(OrderChannel.TELEPHONE)
  })
})

describe('toggledOrderChannel', () => {
  it('schaltet zwischen Kasse und Telefon hin und her', () => {
    expect(toggledOrderChannel(OrderChannel.POS)).toBe(OrderChannel.TELEPHONE)
    expect(toggledOrderChannel(OrderChannel.TELEPHONE)).toBe(OrderChannel.POS)
  })

  it('ist zweimal angewendet die Identität', () => {
    for (const start of [OrderChannel.POS, OrderChannel.TELEPHONE] as const) {
      expect(toggledOrderChannel(toggledOrderChannel(start))).toBe(start)
    }
  })

  it('führt aus ONLINE und APP heraus zur Kasse', () => {
    // Beide entstehen nicht an der Kasse. Landet ein solcher Wert doch einmal
    // im Dialog, ist POS die einzige sinnvolle Interpretation eines Tippens —
    // nicht ein Verharren auf einem Kanal, den dieses Gerät nicht bedient.
    expect(toggledOrderChannel(OrderChannel.ONLINE)).toBe(OrderChannel.POS)
    expect(toggledOrderChannel(OrderChannel.APP)).toBe(OrderChannel.POS)
  })
})
