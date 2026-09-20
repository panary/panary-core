/**
 * Zerlegt einen gerenderten ESC/POS-Strom in Zeilen und misst je Zeile, wo der
 * Text auf dem Papier tatsaechlich sitzt — in Dots, nicht in Zeichen.
 *
 * Warum in Dots: Der Versatz aus panary/panary-core#342 ist in Zeichen
 * unsichtbar. Der Encoder zaehlt die Zentrier-Polsterung in den Spalten des
 * Fonts, der fuer den TEXT gilt (Font B: 48 → 64 Spalten), stellt sie im
 * Bytestrom aber VOR den Font-Umschaltbefehl — gedruckt werden die Leerzeichen
 * also noch in der breiteren Zelle des alten Fonts. Eine Assertion auf die
 * Anzahl der Leerzeichen haette das durchgewunken; erst die Zellenbreite macht
 * den Fehler messbar.
 *
 * Standard-ESC/POS: Font A = 12 Dots breit, Font B = 9. Dieselben Verhaeltnisse
 * rechnet der Encoder intern (48 Font-A-Spalten → 64 Font-B-Spalten = 576/9).
 */

const DOTS_FONT_A = 12
const DOTS_FONT_B = 9

type PrinterState = { fontDots: number; widthMultiplier: number }

export type DecodedLine = {
  /** Sichtbarer Text der Zeile, ohne Steuerzeichen und ohne Polsterung. */
  text: string
  /** Breite der fuehrenden Leerzeichen in Dots — jedes in SEINER Zelle gezaehlt. */
  leadDots: number
  /** Breite des Textes in Dots, vom ersten bis zum letzten sichtbaren Zeichen. */
  contentDots: number
  /** Zellenbreite des ersten sichtbaren Zeichens — Toleranzmass der Zentrierung. */
  charDots: number
}

/**
 * Bekannte Steuersequenzen mit ihrer Gesamtlaenge in Bytes. Alles andere laesst
 * `decodeEscPosLines` absichtlich auflaufen: Eine unbekannte Sequenz still als
 * Text zu zaehlen verschoebe jede Messung, und ein Layout-Test, der sich selbst
 * verrechnet, meldet „mittig", ohne hingesehen zu haben.
 */
const COMMAND_LENGTHS: Record<string, number> = {
  '1b40': 2, // ESC @  — initialize
  '1c2e': 2, // FS .   — single byte character mode
  '1b4d': 3, // ESC M  — font
  '1b74': 3, // ESC t  — codepage
  '1b45': 3, // ESC E  — bold
  '1b2d': 3, // ESC -  — underline
  '1b34': 3, // ESC 4  — italic on
  '1b35': 2, // ESC 5  — italic off
  '1b61': 3, // ESC a  — alignment (Hardware)
  '1d21': 3, // GS !   — character size
  '1d42': 3, // GS B   — invert
}

const hex = (n: number): string => n.toString(16).padStart(2, '0')

/**
 * @param bytes  gerenderter Bon/Beleg
 * @param maxLines  nur der Kopfbereich wird gemessen — weiter hinten stehen QR-Code
 *                  und Bildbefehle, deren Laenge diese Tabelle bewusst nicht kennt.
 */
export function decodeEscPosLines(bytes: Uint8Array, maxLines: number): DecodedLine[] {
  const state: PrinterState = { fontDots: DOTS_FONT_A, widthMultiplier: 1 }
  const lines: DecodedLine[] = []

  let leadDots = 0
  let contentDots = 0
  let charDots = 0
  let text = ''
  let seenVisible = false

  const pushLine = (): void => {
    lines.push({ text, leadDots, contentDots, charDots })
    leadDots = 0
    contentDots = 0
    charDots = 0
    text = ''
    seenVisible = false
  }

  for (let i = 0; i < bytes.length && lines.length < maxLines;) {
    const byte = bytes[i]

    if (byte === 0x0a) {
      pushLine()
      i += 1
      continue
    }
    if (byte === 0x0d) {
      i += 1
      continue
    }

    if (byte === 0x1b || byte === 0x1c || byte === 0x1d) {
      const key = `${hex(byte)}${hex(bytes[i + 1])}`
      const length = COMMAND_LENGTHS[key]
      if (length === undefined) {
        throw new Error(
          `Unbekannte ESC/POS-Sequenz ${key} an Byte ${i} — Tabelle in test/escpos-layout.ts ergaenzen, ` +
            'sonst misst der Layout-Test still falsch.',
        )
      }
      if (key === '1b4d') state.fontDots = bytes[i + 2] === 1 ? DOTS_FONT_B : DOTS_FONT_A
      if (key === '1d21') state.widthMultiplier = (bytes[i + 2] >> 4) + 1
      if (key === '1b40') {
        state.fontDots = DOTS_FONT_A
        state.widthMultiplier = 1
      }
      i += length
      continue
    }

    const cellDots = state.fontDots * state.widthMultiplier
    if (byte === 0x20 && !seenVisible) {
      leadDots += cellDots
    } else {
      seenVisible = true
      contentDots += cellDots
      if (charDots === 0) charDots = cellDots
      text += String.fromCharCode(byte)
    }
    i += 1
  }

  // Rechtsbuendige Polsterung ist keine Zentrierung — nachlaufende Leerzeichen
  // gehoeren nicht in `contentDots`, sonst waere jede Zeile „mittig".
  return lines.map(line => {
    const trimmed = line.text.replace(/ +$/, '')
    const removed = line.text.length - trimmed.length
    return { ...line, text: trimmed, contentDots: line.contentDots - removed * (line.charDots || 0) }
  })
}

/** Papierbreite in Dots — Spaltenzahl gilt fuer Font A (58 mm = 32, 80 mm = 48). */
export const paperDots = (columns: number): number => columns * DOTS_FONT_A

/**
 * Abstand der Textmitte von der Papiermitte, in Dots. 0 = exakt mittig,
 * positiv = zu weit rechts.
 */
export const centerOffsetDots = (line: DecodedLine, columns: number): number =>
  line.leadDots + line.contentDots / 2 - paperDots(columns) / 2
