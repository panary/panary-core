import net from 'net'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { buildTestPrintDocument, executeOrderReceiptJob, type PrinterConfig } from './print-job.builder'
import { renderOrderReceipt } from './order-receipt.renderer'

const datumsZeile = (elements: ReturnType<typeof buildTestPrintDocument>): string => {
  const el = elements.find(e => e.type === 'text' && typeof e.text === 'string' && e.text.startsWith('Datum: '))
  return el && 'text' in el ? (el.text as string) : ''
}

// #274: Auch der Testdruck formatierte ohne Zeitzone und zeigte im Container die
// UTC-Zeit. Der Zeitpunkt ist hier `new Date()` (der Testdruck belegt die
// Hardware, nicht einen Vorgang) — geprueft wird deshalb der Abstand zwischen
// zwei Zonen, nicht ein fester Wert.
describe('print-job.builder — Testdruck-Zeitzone (#274)', () => {
  it('formatiert das Datum in der uebergebenen Zone', () => {
    const berlin = datumsZeile(buildTestPrintDocument('Kasse 1', 'Europe/Berlin'))
    const newYork = datumsZeile(buildTestPrintDocument('Kasse 1', 'America/New_York'))

    expect(berlin).toMatch(/^Datum: \d{1,2}\.\d{1,2}\.\d{4}, \d{1,2}:\d{2}:\d{2}$/)
    // Sechs Stunden Abstand (Sommer) bzw. sieben (Winter) — in jedem Fall eine
    // andere Uhrzeit. Gleiche Ausgabe hiesse: die Zone wird ignoriert.
    expect(newYork).not.toBe(berlin)
  })

  it('faellt ohne Zone auf den Geschaeftstag-Default zurueck', () => {
    expect(datumsZeile(buildTestPrintDocument('Kasse 1'))).toBe(
      datumsZeile(buildTestPrintDocument('Kasse 1', 'Europe/Berlin')),
    )
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #346: Bestellbon je Zieldrucker rendern
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ein echter TCP-Listener auf 127.0.0.1 statt eines Modul-Mocks von
 * `sendToNetworkPrinter`. Zwei Gruende:
 *
 * 1. Der Test misst, was tatsaechlich AUF DER LEITUNG landet — genau die Stelle,
 *    an der bis #346 fuer alle Drucker derselbe Buffer stand.
 * 2. Spec-Isolation (§10): Jeder Test legt seine eigenen Server an und schreibt
 *    in sein eigenes Aufzeichnungsobjekt. Ein Nachzuegler aus einem abgebrochenen
 *    Test fuellt seinen eigenen, toten Puffer und erreicht den naechsten nicht.
 */
function createFakePrinter() {
  const chunks: Buffer[] = []
  let verbindungGeschlossen: () => void
  const geschlossen = new Promise<void>(resolve => {
    verbindungGeschlossen = resolve
  })

  const server = net.createServer(socket => {
    socket.on('data', chunk => chunks.push(chunk))
    socket.on('close', () => verbindungGeschlossen())
  })

  return {
    async listen(): Promise<number> {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
      return (server.address() as net.AddressInfo).port
    },
    /** Empfangene Bytes — erst aufrufen, nachdem `warteAufZustellung()` zurueckkam. */
    empfangen: (): Uint8Array => new Uint8Array(Buffer.concat(chunks)),
    async warteAufZustellung(): Promise<void> {
      // `sendToNetworkPrinter` loest im write-Callback auf und zerstoert den
      // Socket danach; das `close` des Servers kommt also unmittelbar. Die
      // Frist ist eine Reissleine gegen ein Haengen, kein Taktgeber.
      await Promise.race([
        geschlossen,
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Drucker hat keine Daten erhalten')), 2000).unref(),
        ),
      ])
    },
    async close(): Promise<void> {
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

/** Freier Port, auf dem NICHTS lauscht — erzwingt ECONNREFUSED. */
async function freierPort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as net.AddressInfo).port
  await new Promise<void>(resolve => server.close(() => resolve()))
  return port
}

const drucker = (over: Partial<PrinterConfig> & Pick<PrinterConfig, 'pid' | 'name' | 'port'>): PrinterConfig => ({
  active: true,
  type: 'ip',
  ip: '127.0.0.1',
  ...over,
})

const bonLocation = {
  settings: {
    generalSettings: { timezone: 'Europe/Berlin' },
    genericProductSettings: { generalDrinkPrice: 3.5, generalSideDishPrice: 1.0 },
  },
}

const bonOrder = {
  dailySequenceNumber: 815,
  dineLocation: 'take-out',
  recordingDate: '2026-09-21T10:00:00.000Z',
  estimatedDuration: 15,
  lineItems: [
    { _id: 'li-1', name: 'Pommes gross', topic: 'Speisen', amount: 2, price: 4.9, taxInside: 19, taxOutside: 7 },
  ],
}

const auftrag = { order: bonOrder, location: bonLocation, orderId: 'order-346', deviceName: 'Kasse 1' }

/**
 * Breite der Trennlinie in Zeichen — sie laeuft ueber die volle Spaltenzahl und
 * ist damit der direkt messbare Beleg, mit welcher `COLUMNS_MAP`-Breite gerendert
 * wurde (58mm=32, 80mm=48).
 */
const trennlinienBreite = (bytes: Uint8Array): number => {
  const text = new TextDecoder('latin1').decode(bytes)
  const breiten = text
    .split(/[\n\r]/)
    // eslint-disable-next-line no-control-regex
    .map(zeile => zeile.replace(/[\x00-\x1f]/g, ''))
    .filter(zeile => zeile.length > 8 && /^(.)\1+$/.test(zeile))
    .map(zeile => zeile.length)

  expect(breiten.length).toBeGreaterThan(0)
  // Alle Trennlinien eines Bons sind gleich breit; unterschiedliche Werte hiessen,
  // die Messung greift die falschen Zeilen ab.
  expect(new Set(breiten).size).toBe(1)
  return breiten[0]
}

describe('executeOrderReceiptJob — ein Bon je Zieldrucker (#346)', () => {
  it('rendert fuer jeden Drucker mit SEINER Papierbreite', async () => {
    const achtzig = createFakePrinter()
    const achtundfuenfzig = createFakePrinter()

    try {
      const ergebnis = await executeOrderReceiptJob(auftrag, [
        drucker({ pid: 'p80', name: 'Theke 80mm', port: await achtzig.listen(), paperWidth: '80mm' }),
        drucker({ pid: 'p58', name: 'Kueche 58mm', port: await achtundfuenfzig.listen(), paperWidth: '58mm' }),
      ])
      await achtzig.warteAufZustellung()
      await achtundfuenfzig.warteAufZustellung()

      expect(ergebnis.success).toBe(true)

      const bon80 = achtzig.empfangen()
      const bon58 = achtundfuenfzig.empfangen()

      // Der eigentliche Befund von #346: Bis dahin war das DERSELBE Buffer.
      expect(bon58).not.toEqual(bon80)

      // Und zwar nicht irgendwie verschieden, sondern jeweils exakt das, was der
      // Renderer fuer diese Breite erzeugt.
      expect(bon80).toEqual(renderOrderReceipt(bonOrder, bonLocation, { paperWidth: '80mm' }, 'Kasse 1'))
      expect(bon58).toEqual(renderOrderReceipt(bonOrder, bonLocation, { paperWidth: '58mm' }, 'Kasse 1'))

      // Spaltenzahl am Papier gemessen, nicht aus der Option abgelesen.
      expect(trennlinienBreite(bon80)).toBe(48)
      expect(trennlinienBreite(bon58)).toBe(32)
    } finally {
      await Promise.all([achtzig.close(), achtundfuenfzig.close()])
    }
  })

  it('faellt ohne `paperWidth` je Drucker auf 80 mm zurueck', async () => {
    const ohneAngabe = createFakePrinter()

    try {
      await executeOrderReceiptJob(auftrag, [
        drucker({ pid: 'p0', name: 'Ohne Angabe', port: await ohneAngabe.listen() }),
      ])
      await ohneAngabe.warteAufZustellung()

      expect(trennlinienBreite(ohneAngabe.empfangen())).toBe(48)
    } finally {
      await ohneAngabe.close()
    }
  })

  it('liefert zwei Druckern gleicher Breite denselben Bon — keine Regression', async () => {
    const a = createFakePrinter()
    const b = createFakePrinter()

    try {
      await executeOrderReceiptJob(auftrag, [
        drucker({ pid: 'pa', name: 'Kasse A', port: await a.listen(), paperWidth: '80mm' }),
        drucker({ pid: 'pb', name: 'Kasse B', port: await b.listen(), paperWidth: '80mm' }),
      ])
      await a.warteAufZustellung()
      await b.warteAufZustellung()

      expect(a.empfangen()).toEqual(b.empfangen())
    } finally {
      await Promise.all([a.close(), b.close()])
    }
  })

  it('reisst bei einem unerreichbaren Ziel die uebrigen nicht mit', async () => {
    const erreichbar = createFakePrinter()

    try {
      const ergebnis = await executeOrderReceiptJob(auftrag, [
        drucker({ pid: 'ptot', name: 'Abgezogen', port: await freierPort(), paperWidth: '58mm' }),
        drucker({ pid: 'plebt', name: 'Kueche', port: await erreichbar.listen(), paperWidth: '80mm' }),
      ])
      await erreichbar.warteAufZustellung()

      expect(ergebnis.success).toBe(false)
      // Die Ergebnisliste bleibt JE DRUCKER erhalten — der Ausfall wird nur fuer
      // das defekte Ziel gemeldet, nicht als Gesamtfehler.
      expect(ergebnis.results).toHaveLength(2)
      expect(ergebnis.results[0]).toMatchObject({ printerId: 'ptot', success: false })
      expect(ergebnis.results[0].error).toBeTruthy()
      expect(ergebnis.results[1]).toMatchObject({ printerId: 'plebt', success: true })

      // Und das erreichbare Ziel hat seinen vollstaendigen Bon bekommen.
      expect(trennlinienBreite(erreichbar.empfangen())).toBe(48)
    } finally {
      await erreichbar.close()
    }
  })
})
