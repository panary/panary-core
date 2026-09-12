import { describe, expect, it } from 'vitest'

import { buildTestPrintDocument } from './print-job.builder'

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
