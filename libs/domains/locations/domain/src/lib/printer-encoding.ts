/**
 * Zeichensatz eines Bondruckers (`printSettings.printers[].encoding`, #376).
 *
 * Das Feld ist ein freier String im Schema und bleibt das auch: Bestandswerte
 * stammen aus einem Freitextfeld („CP437", „cp858", Tippfehler), und ein
 * engeres Schema wiese die Filiale beim naechsten Speichern oder Sync ab. Die
 * Auswertung normalisiert deshalb hier und faellt bei Unbekanntem auf CP437
 * zurueck — ein Tippfehler darf keinen Bon verhindern.
 *
 * `codepage` ist der Bezeichner von `@point-of-sale/receipt-printer-encoder`.
 * Angeboten wird nur, was die dort voreingestellte Zuordnung `epson` kennt —
 * sonst wirft der Encoder „Codepage not supported by printer".
 */
export const PRINTER_ENCODINGS = [
  { value: 'CP437', codepage: 'cp437', label: 'CP437 (Standard)' },
  { value: 'CP850', codepage: 'cp850', label: 'CP850 — Westeuropa' },
  { value: 'CP858', codepage: 'cp858', label: 'CP858 — Westeuropa mit €' },
  { value: 'WINDOWS-1252', codepage: 'windows1252', label: 'Windows-1252 — mit €, „ " und –' },
] as const

export type PrinterEncodingValue = (typeof PRINTER_ENCODINGS)[number]['value']

/** Voreinstellung des Encoders ohne Angabe — bis #376 der einzige Zeichensatz. */
export const DEFAULT_PRINTER_CODEPAGE = 'cp437'

export interface ResolvedPrinterCodepage {
  /** Encoder-Bezeichner, immer gueltig. */
  codepage: string
  /** `false`, wenn ein gepflegter Wert nicht erkannt und durch CP437 ersetzt wurde. */
  known: boolean
}

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Bildet den gepflegten Wert auf eine Encoder-Codepage ab. Gross-/Kleinschreibung
 * und Trennzeichen zaehlen nicht („cp-858", „Windows 1252"). Leer oder fehlend
 * ist die Voreinstellung und gilt als bekannt.
 */
export function resolvePrinterCodepage(encoding: string | null | undefined): ResolvedPrinterCodepage {
  if (encoding == null || encoding.trim() === '') return { codepage: DEFAULT_PRINTER_CODEPAGE, known: true }

  const wanted = normalize(encoding)
  const match = PRINTER_ENCODINGS.find(e => normalize(e.value) === wanted)
  return match ? { codepage: match.codepage, known: true } : { codepage: DEFAULT_PRINTER_CODEPAGE, known: false }
}

/**
 * Kanonischer Auswahlwert fuer die Maske: „cp858" → „CP858", leer → „CP437".
 * `null` fuer einen unbekannten Bestandswert — die Maske zeigt ihn dann als
 * eigene Option an, statt ihn beim naechsten Speichern still zu ersetzen.
 */
export function canonicalPrinterEncoding(encoding: string | null | undefined): PrinterEncodingValue | null {
  const { codepage, known } = resolvePrinterCodepage(encoding)
  if (!known) return null
  return PRINTER_ENCODINGS.find(e => e.codepage === codepage)?.value ?? null
}
