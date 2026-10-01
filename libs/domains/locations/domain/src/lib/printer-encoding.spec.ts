import { describe, expect, it } from 'vitest'
import {
  canonicalPrinterEncoding,
  DEFAULT_PRINTER_CODEPAGE,
  PRINTER_ENCODINGS,
  resolvePrinterCodepage,
} from './printer-encoding'

describe('resolvePrinterCodepage (#376)', () => {
  it.each([undefined, null, '', '   '])('liefert fuer %j die Voreinstellung als bekannt', value => {
    expect(resolvePrinterCodepage(value)).toEqual({ codepage: 'cp437', known: true })
  })

  it('bildet jeden angebotenen Wert auf seine Codepage ab', () => {
    for (const e of PRINTER_ENCODINGS) {
      expect(resolvePrinterCodepage(e.value)).toEqual({ codepage: e.codepage, known: true })
    }
  })

  // Bestandswerte stammen aus einem Freitextfeld.
  it.each([
    ['cp858', 'cp858'],
    ['CP-858', 'cp858'],
    [' cp437 ', 'cp437'],
    ['Windows 1252', 'windows1252'],
    ['windows1252', 'windows1252'],
  ])('erkennt die Schreibweise %j', (value, codepage) => {
    expect(resolvePrinterCodepage(value)).toEqual({ codepage, known: true })
  })

  it('erkennt jeden Encoder-Bezeichner als bekannt — der Edge loest zweimal auf', () => {
    for (const e of PRINTER_ENCODINGS) {
      expect(resolvePrinterCodepage(e.codepage)).toEqual({ codepage: e.codepage, known: true })
    }
  })

  it.each(['CP9999', 'UTF-8', 'latin1'])('faellt fuer den unbekannten Wert %j auf CP437 zurueck', value => {
    expect(resolvePrinterCodepage(value)).toEqual({ codepage: DEFAULT_PRINTER_CODEPAGE, known: false })
  })

  it('bietet CP437 als ersten Eintrag an — er ist der Default der Maske', () => {
    expect(PRINTER_ENCODINGS[0].value).toBe('CP437')
    expect(PRINTER_ENCODINGS[0].codepage).toBe(DEFAULT_PRINTER_CODEPAGE)
  })
})

describe('canonicalPrinterEncoding (#376)', () => {
  it.each([
    [undefined, 'CP437'],
    ['', 'CP437'],
    ['cp858', 'CP858'],
    ['windows 1252', 'WINDOWS-1252'],
  ])('ordnet %j der Option %j zu', (value, expected) => {
    expect(canonicalPrinterEncoding(value)).toBe(expected)
  })

  it('liefert fuer einen unbekannten Bestandswert null', () => {
    expect(canonicalPrinterEncoding('CP9999')).toBeNull()
  })
})
