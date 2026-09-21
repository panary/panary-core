import net from 'net'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

import { logger } from '@panary/shared-backend'
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
    // Ohne `setEncoding` liefert der Socket zur Laufzeit immer Buffer; die
    // Node-Typen deklarieren `string | Buffer`, weil eine Kodierung gesetzt sein
    // KOENNTE. Der Parameter wird deshalb hier festgelegt statt das Ergebnis
    // umzudeuten.
    socket.on('data', (chunk: Buffer) => chunks.push(chunk))
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
    // Handle im TEST leeren, nicht in `beforeEach` (§10). In dieser Spec kann
    // ohnehin kein Nachzuegler entstehen — jeder async-Pfad wird awaited —, aber
    // die Stelle ist die, an der das Muster sonst einzieht.
    vi.mocked(logger.error).mockClear()

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

      // Das Fehler-Event benennt die gescheiterte HAELFTE: Hier ist das Rendern
      // durchgelaufen und das Senden gescheitert. Ohne `phase` sieht ein
      // Renderfehler im Edge-Log aus wie ein abgezogenes Kabel.
      expect(vi.mocked(logger.error)).toHaveBeenCalledTimes(1)
      expect(vi.mocked(logger.error).mock.calls[0][0]).toMatchObject({
        event: 'print.order_error',
        printer: 'Abgezogen',
        paperWidth: '58mm',
        phase: 'send',
      })
    } finally {
      await erreichbar.close()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// #347: Druckerrolle entscheidet ueber die Bon-Variante
// ─────────────────────────────────────────────────────────────────────────────

const filialeMitKopf = {
  name: 'Koetters Fritte',
  address: { street: 'Dahler Strasse 35', postalCode: '58091', city: 'Hagen' },
  phone: '02331 1234567',
  settings: bonLocation.settings,
}

const auftragMitKopf = { ...auftrag, location: filialeMitKopf, orderId: 'order-347' }

const alsText = (bytes: Uint8Array): string =>
  // eslint-disable-next-line no-control-regex
  new TextDecoder('latin1').decode(bytes).replace(/[\x00-\x1f]/g, ' ')

describe('executeOrderReceiptJob — Bon-Variante je Druckerrolle (#347)', () => {
  it.each([
    ['kitchen', false],
    ['receipt', true],
    ['both', true],
  ] as const)('Rolle `%s` → Filialkopf gedruckt: %s', async (role, mitKopf) => {
    const ziel = createFakePrinter()

    try {
      await executeOrderReceiptJob(auftragMitKopf, [
        drucker({ pid: 'p1', name: `Drucker ${role}`, port: await ziel.listen(), role }),
      ])
      await ziel.warteAufZustellung()

      const text = alsText(ziel.empfangen())
      expect(text.includes('Dahler Strasse 35')).toBe(mitKopf)
      expect(text.includes('Koetters Fritte')).toBe(mitKopf)
      // Was der Kuechenbon behaelt — die Variante darf nur Kopf und TSE schalten.
      expect(text).toContain('Pommes gross')
      expect(text).toContain('Gesamt')
    } finally {
      await ziel.close()
    }
  })

  it('druckt fuer einen Bestandsdrucker OHNE `role` den Vollbon', async () => {
    // 🚨 Der Kern der Bestands-Sicherheit: Nach dem Update darf kein einziger
    // bestehender Drucker still zum Kuechendrucker werden. `drucker()` setzt
    // `role` bewusst nicht — genau der Zustand jeder Installation vor #347.
    const ziel = createFakePrinter()

    try {
      await executeOrderReceiptJob(auftragMitKopf, [
        drucker({ pid: 'p-alt', name: 'Bestandsdrucker', port: await ziel.listen() }),
      ])
      await ziel.warteAufZustellung()

      expect(alsText(ziel.empfangen())).toContain('Dahler Strasse 35')
    } finally {
      await ziel.close()
    }
  })

  it('gibt Kueche und Kasse in EINEM Auftrag zwei verschiedene Bons', async () => {
    // Das ist der beobachtbare Zweck des Features: eine Bestellung, zwei
    // unterschiedliche Ausdrucke. Vor #346 war es derselbe Buffer, vor #347
    // dieselbe Vorlage.
    const kueche = createFakePrinter()
    const kasse = createFakePrinter()

    try {
      const ergebnis = await executeOrderReceiptJob(auftragMitKopf, [
        drucker({ pid: 'p-k', name: 'Kueche', port: await kueche.listen(), role: 'kitchen' }),
        drucker({ pid: 'p-r', name: 'Theke', port: await kasse.listen(), role: 'receipt' }),
      ])
      await kueche.warteAufZustellung()
      await kasse.warteAufZustellung()

      expect(ergebnis.success).toBe(true)

      const bonKueche = kueche.empfangen()
      const bonKasse = kasse.empfangen()

      expect(bonKueche).not.toEqual(bonKasse)
      expect(bonKueche).toEqual(
        renderOrderReceipt(bonOrder, filialeMitKopf, { paperWidth: '80mm', variant: 'kitchen' }, 'Kasse 1'),
      )
      expect(bonKasse).toEqual(
        renderOrderReceipt(bonOrder, filialeMitKopf, { paperWidth: '80mm', variant: 'full' }, 'Kasse 1'),
      )

      // Beide auf 80 mm — der Unterschied kommt von der Rolle, nicht von der
      // Papierbreite. Ohne diese Zeile belegte der Test auch #346 noch einmal.
      expect(trennlinienBreite(bonKueche)).toBe(48)
      expect(trennlinienBreite(bonKasse)).toBe(48)
    } finally {
      await Promise.all([kueche.close(), kasse.close()])
    }
  })

  it('nennt die Variante im Erfolgs-Event', async () => {
    // `/print-server/*` laeuft nicht durch `canonicalLog` — welche Vorlage ein
    // Drucker bekam, steht sonst nirgends. Ohne das Feld sieht ein falsch
    // gerollter Drucker im Log aus wie ein richtig gerollter.
    const ziel = createFakePrinter()

    try {
      vi.mocked(logger.info).mockClear()
      await executeOrderReceiptJob(auftragMitKopf, [
        drucker({ pid: 'p-log', name: 'Kueche', port: await ziel.listen(), role: 'kitchen' }),
      ])
      await ziel.warteAufZustellung()

      expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'print.order_success', variant: 'kitchen', paperWidth: '80mm' }),
      )
    } finally {
      await ziel.close()
    }
  })
})
