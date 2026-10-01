import { describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// @ts-expect-error — keine Typdeklarationen vorhanden
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import { logger } from '@panary/shared-backend'
import { buildEscposBuffer, createEscposEncoder } from './escpos.adapter'

const TEXT = 'Grüße: ä ö ü ß — Café 3,50 €'

/**
 * Der Bytestrom VOR #376: Encoder ohne jede Codepage-Angabe. Bewusst direkt
 * gegen die Library gebaut, nicht ueber `createEscposEncoder` — sonst verglichen
 * die Byte-Gleichheits-Tests den neuen Code mit sich selbst.
 */
const ohneCodepage = (columns: number): Uint8Array => {
  const enc = new ReceiptPrinterEncoder({ columns, language: 'esc-pos' })
  enc.initialize()
  enc.text(TEXT)
  enc.newline()
  return enc.encode()
}

describe('createEscposEncoder (#376)', () => {
  it.each([undefined, '', 'CP437', 'cp437'])('ist mit Encoding %j byte-identisch zum Stand davor', encoding => {
    const enc = createEscposEncoder(48, encoding)
    enc.initialize()
    enc.text(TEXT)
    enc.newline()

    expect(enc.encode()).toEqual(ohneCodepage(48))
  })

  it('ist auch im Vorlagen-Pfad ohne Encoding byte-identisch', () => {
    expect(buildEscposBuffer([{ type: 'text', text: TEXT }], { paperWidth: '58mm' })).toEqual(ohneCodepage(32))
  })

  it.each([
    ['CP850', 'cp850'],
    ['CP858', 'cp858'],
    ['WINDOWS-1252', 'windows1252'],
  ])('wirft fuer den angebotenen Wert %j nicht', encoding => {
    // Die Library wirft „Codepage not supported by printer", wenn die
    // Epson-Zuordnung den Wert nicht kennt — ein angebotener Wert, der das tut,
    // verhinderte jeden Bon des Druckers.
    expect(() => buildEscposBuffer([{ type: 'text', text: TEXT }], { encoding })).not.toThrow()
  })

  it('druckt Windows-1252 mit €, Halbgeviertstrich und Anfuehrungszeichen', () => {
    const bytes = buildEscposBuffer([{ type: 'text', text: '„Menü" – 3,50 €' }], { encoding: 'Windows-1252' })
    // 0x84 „  0x96 –  0x80 €  (Windows-1252)
    for (const b of [0x84, 0x96, 0x80]) expect(bytes.includes(b)).toBe(true)
    expect(bytes.includes(0x3f)).toBe(false) // kein `?`
  })

  it('faellt bei unbekanntem Wert auf CP437 zurueck und schreibt ein Event', () => {
    vi.mocked(logger.warn).mockClear()
    const enc = createEscposEncoder(48, 'CP9999')
    enc.initialize()
    enc.text(TEXT)
    enc.newline()

    expect(enc.encode()).toEqual(ohneCodepage(48))
    expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'print.encoding_unknown', encoding: 'CP9999', codepage: 'cp437' }),
    )
  })
})
