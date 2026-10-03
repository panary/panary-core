import { describe, expect, it, vi } from 'vitest'

vi.mock('@panary/shared-backend', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

// @ts-expect-error — keine Typdeklarationen vorhanden
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'
import { logger } from '@panary/shared-backend'
import { buildEscposBuffer, createEscposEncoder } from './escpos.adapter'
import { ESCPOS_TRANSLITERATION, transliterateForCodepage } from './escpos-transliteration'

/**
 * Bewusst ohne typografische Zeichen: Die ersetzt seit #517 die
 * Transliteration, ein Vergleich mit dem rohen Encoder (der sie als `?` druckt)
 * hielte sonst genau den behobenen Fehler fest.
 */
const TEXT = 'Grüße: ä ö ü ß - Café 3,50 EUR'

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

/** Nur die Text-Bytes einer Zeile, ohne Steuersequenzen. */
const textBytes = (value: string, encoding?: string): number[] => {
  const enc = createEscposEncoder(48, encoding)
  enc.text(value)
  return enc
    .encode('lines')
    .flat()
    .filter((item: { type: string }) => item.type === 'text')
    .flatMap((item: { payload: number[] }) => item.payload)
}
const ascii = (value: string) => [...value].map(c => c.charCodeAt(0))

describe('Transliteration (#517)', () => {
  it.each([
    ['Sandwich \u2013 klein', 'Sandwich - klein'],
    ['Tagesgericht \u2014 Mittag', 'Tagesgericht - Mittag'],
    ['Men\u00fc \u201eKlassiker\u201c', 'Men\u00fc "Klassiker"'],
    ['\u201dzitiert\u201d', '"zitiert"'],
    ['\u201aeinfach\u2018 und \u2019so\u2019', "'einfach' und 'so'"],
    ['Mehr\u2026', 'Mehr...'],
    ['Preis 3,50 \u20ac', 'Preis 3,50 EUR'],
    ['Tee \u2192 Kanne', 'Tee -> Kanne'],
    ['2 \u00d7 Brezel', '2 x Brezel'],
    ['Br\u00f6tchen\u202fhell', 'Br\u00f6tchen hell'],
  ])('druckt %j unter CP437 als %j', (name, erwartet) => {
    expect(transliterateForCodepage(name, 'cp437')).toBe(erwartet)
  })

  it('ersetzt nur durch reines ASCII — jeder Ersatz ist in jeder Codepage darstellbar', () => {
    for (const ersatz of Object.values(ESCPOS_TRANSLITERATION)) expect(ersatz).toMatch(/^[\x20-\x7e]*$/)
  })

  it('druckt \u20ac unter CP437 als EUR', () => {
    expect(textBytes('3,50 \u20ac', 'CP437')).toEqual(ascii('3,50 EUR'))
  })

  it('laesst \u20ac unter CP858 das Eurozeichen', () => {
    // 0xD5 ist das Eurozeichen in CP858 — eine pauschale Ersetzung naehme #376 sein Ergebnis
    expect(textBytes('3,50 \u20ac', 'CP858')).toEqual([...ascii('3,50 '), 0xd5])
  })

  it('laesst unter Windows-1252 Striche und Anfuehrungszeichen stehen', () => {
    expect(transliterateForCodepage('\u201eMen\u00fc\u201c \u2013 3,50 \u20ac', 'windows1252')).toBe(
      '\u201eMen\u00fc\u201c \u2013 3,50 \u20ac',
    )
  })

  it('laesst Umlaute und Akzente unveraendert', () => {
    expect(transliterateForCodepage('Gr\u00fc\u00dfe Caf\u00e9 \u00e0 la cr\u00e8me', 'cp437')).toBe(
      'Gr\u00fc\u00dfe Caf\u00e9 \u00e0 la cr\u00e8me',
    )
  })

  it('setzt zerlegte Umlaute zusammen (NFC)', () => {
    expect(transliterateForCodepage('Mu\u0308sli', 'cp437')).toBe('M\u00fcsli')
  })

  it('druckt ein Zeichen, das CP437 auf ein Steuerbyte legt, nicht als Steuerbyte', () => {
    // Die Library bildet \u2665 unter CP437 auf 0x03 ab — im ESC/POS-Strom ein Steuerzeichen
    const bytes = textBytes('Herz \u2665', 'CP437')
    expect(bytes.every(b => b >= 0x20)).toBe(true)
    expect(bytes).toEqual(ascii('Herz ?'))
  })

  it('meldet Unbekanntes einmal je Bon als print.unmappable_chars', () => {
    vi.mocked(logger.warn).mockClear()
    const enc = createEscposEncoder(48, 'CP437')
    enc.line('Herz \u2665 \u2665')
    enc.table(
      [
        { width: 24, align: 'left' },
        { width: 24, align: 'left' },
      ],
      [['Stern \u2605', (e: any) => e.bold(true).text('\u2665').bold(false)]],
    )
    enc.encode()

    const events = vi.mocked(logger.warn).mock.calls.filter(([arg]: any[]) => arg.event === 'print.unmappable_chars')
    expect(events).toHaveLength(1)
    expect(events[0][0]).toEqual(
      expect.objectContaining({
        codepage: 'cp437',
        chars: [
          { char: '\u2665', codepoint: 'U+2665', count: 3 },
          { char: '\u2605', codepoint: 'U+2605', count: 1 },
        ],
      }),
    )
  })

  it('schreibt ohne unbekannte Zeichen kein Event', () => {
    vi.mocked(logger.warn).mockClear()
    const enc = createEscposEncoder(48, 'CP437')
    enc.line('Sandwich \u2013 klein')
    enc.encode()
    expect(vi.mocked(logger.warn)).not.toHaveBeenCalled()
  })

  it('ersetzt auch in Tabellenzellen (Text und Callback)', () => {
    const enc = createEscposEncoder(48, 'CP437')
    enc.table(
      [
        { width: 24, align: 'left' },
        { width: 24, align: 'left' },
      ],
      [['Sandwich \u2013 klein', (e: any) => e.bold(true).text('3,50 \u20ac').bold(false)]],
    )
    const bytes: number[] = enc
      .encode('lines')
      .flat()
      .filter((item: { type: string }) => item.type === 'text')
      .flatMap((item: { payload: number[] }) => item.payload)
    expect(bytes.includes(0x3f)).toBe(false)
    expect(String.fromCharCode(...bytes)).toContain('Sandwich - klein')
    expect(String.fromCharCode(...bytes)).toContain('3,50 EUR')
  })

  it.each([undefined, 'CP858', 'Windows-1252'])(
    'laesst einen Bon ohne Sonderzeichen unter %j byte-identisch (Text, line, Tabelle)',
    encoding => {
      const name = 'Br\u00f6tchen \u00e0 la Caf\u00e9 - 2,10 EUR'
      const bon = (enc: any) => {
        enc.initialize()
        enc.line(name)
        enc.table(
          [
            { width: 30, align: 'left' },
            { width: 18, align: 'right' },
          ],
          [[name, (e: any) => e.bold(true).text('2,10 EUR').bold(false)]],
        )
        enc.text(name).newline()
        return enc.encode()
      }
      const roh = new ReceiptPrinterEncoder({ columns: 48, language: 'esc-pos' })
      roh.codepage(encoding === 'CP858' ? 'cp858' : encoding === 'Windows-1252' ? 'windows1252' : 'cp437')

      expect(bon(createEscposEncoder(48, encoding))).toEqual(bon(roh))
    },
  )
})
