// @ts-expect-error — keine Typdeklarationen vorhanden
import ReceiptPrinterEncoder from '@point-of-sale/receipt-printer-encoder'

/**
 * Ersatz fuer typografische Zeichen, die per Copy-Paste (Word, Web) in
 * Produkt-, Modifier- und Rabattnamen geraten (#517). Greift NUR, wenn die
 * Codepage des Druckers das Zeichen nicht darstellen kann — `€` bleibt unter
 * CP858 das Eurozeichen, `–` unter Windows-1252 der Halbgeviertstrich.
 *
 * Jeder Ersatz ist reines ASCII und damit in jeder Codepage darstellbar.
 */
export const ESCPOS_TRANSLITERATION: Readonly<Record<string, string>> = {
  // Striche
  '‐': '-', // ‐ Bindestrich
  '‑': '-', // ‑ geschuetzter Bindestrich
  '‒': '-', // ‒ Ziffernstrich
  '–': '-', // – Halbgeviertstrich
  '—': '-', // — Geviertstrich
  '−': '-', // − Minuszeichen
  // Anfuehrungszeichen
  '„': '"', // „
  '“': '"', // “
  '”': '"', // ”
  '‟': '"', // ‟
  '«': '"', // «
  '»': '"', // »
  '″': '"', // ″
  '‚': "'", // ‚
  '‘': "'", // ‘
  '’': "'", // ’
  '‛': "'", // ‛
  '′': "'", // ′
  '‹': "'", // ‹
  '›': "'", // ›
  // Sonstiges
  '…': '...', // …
  '€': 'EUR', // € — nur unter Codepages ohne Eurozeichen (CP437, CP850)
  '→': '->', // →
  '←': '<-', // ←
  '×': 'x', // ×
  '·': '.', // ·
  '•': '*', // •
  '™': '(TM)', // ™
  '©': '(C)', // ©
  '®': '(R)', // ®
  // Leerraum
  '\u00a0': ' ', // geschuetztes Leerzeichen
  '\u202f': ' ', // schmales geschuetztes Leerzeichen
  '\u2009': ' ', // schmales Leerzeichen
  '\u2002': ' ', // Halbgeviert-Leerzeichen
  '\u2003': ' ', // Geviert-Leerzeichen
  // Unsichtbares
  '\u00ad': '', // weiches Trennzeichen
  '\u200b': '', // Nullbreite-Leerzeichen
  '\u200c': '',
  '\u200d': '',
  '\ufeff': '',
}

/** Zeichen, das keine Codepage und keine Tabelle traegt, nach #517 als `?` gedruckt. */
export const ESCPOS_UNMAPPABLE = '?'

const NON_ASCII = /[\u0080-\uffff]/
const darstellbarCache = new Map<string, boolean>()

/**
 * Kann die Codepage das Zeichen als druckbares Byte ausgeben? Gemessen an der
 * Library selbst statt an einer eigenen Liste, damit beide nie auseinanderlaufen.
 *
 * Nicht darstellbar ist auch ein Byte < 0x20: CP437 bildet `♥` auf 0x03 und `→`
 * auf 0x1A ab — Glyphen am Bildschirm, aber Steuerzeichen im ESC/POS-Strom.
 * Das Zeichen steht zwischen zwei `x`, weil die Library Leerraum am Zeilenende
 * verwirft und ein geschuetztes Leerzeichen allein keine Bytes ergaebe.
 */
function darstellbar(char: string, codepage: string): boolean {
  const key = `${codepage}\u0000${char}`
  const cached = darstellbarCache.get(key)
  if (cached !== undefined) return cached

  const probe = new ReceiptPrinterEncoder({ language: 'esc-pos' })
  probe.codepage(codepage)
  probe.text(`x${char}x`)
  const bytes: number[] = probe
    .encode('lines')
    .flat()
    .filter((item: { type: string }) => item.type === 'text')
    .flatMap((item: { payload: number[] }) => item.payload)
  const inner = bytes.slice(1, -1)
  const ok = inner.length === 1 && inner[0] >= 0x20 && inner[0] !== 0x3f
  darstellbarCache.set(key, ok)
  return ok
}

/**
 * Ersetzt in `value` jedes Zeichen, das `codepage` nicht darstellen kann —
 * aus der Tabelle, sonst durch `?`. Letzteres wird in `unmappable` gezaehlt.
 *
 * Reines ASCII kommt unveraendert zurueck: Ein Bon ohne Sonderzeichen bleibt
 * byte-identisch zum Stand vor #517.
 */
export function transliterateForCodepage(value: string, codepage: string, unmappable?: Map<string, number>): string {
  if (!NON_ASCII.test(value)) return value

  let out = ''
  // NFC: macOS liefert Umlaute beim Kopieren mitunter zerlegt (`u` + U+0308).
  for (const char of value.normalize('NFC')) {
    if (char.charCodeAt(0) < 0x80 || darstellbar(char, codepage)) {
      out += char
      continue
    }
    const ersatz = ESCPOS_TRANSLITERATION[char]
    if (ersatz !== undefined) {
      out += ersatz
      continue
    }
    out += ESCPOS_UNMAPPABLE
    unmappable?.set(char, (unmappable.get(char) ?? 0) + 1)
  }
  return out
}
