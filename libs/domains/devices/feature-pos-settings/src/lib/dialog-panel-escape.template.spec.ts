import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * core#1418: Das Panel hielt jede Taste an, damit sie nicht zu Hintergrund-Handlern wandert. Nach einem Klick
 * ins Panel lag der Fokus dort, und Esc erreichte den Handler am `window` nie. Esc muss durchlaufen.
 * Die Specs laufen ohne DOM; die Bindung prüft deshalb die Vorlage selbst.
 */
const dialoge = [
  ['Kiosk-PIN', './kiosk-pin-dialog/kiosk-pin-dialog.component.html'],
  ['Entkoppeln', './unpair-device-dialog/unpair-device-dialog.component.html'],
] as const

describe.each(dialoge)('%s-Dialog: Panel-Tastenbindung (core#1418)', (_name, pfad) => {
  const html = readFileSync(fileURLToPath(new URL(pfad, import.meta.url)), 'utf8')

  it('hält keine Taste bedingungslos an', () => {
    expect(html).not.toContain('(keydown)="$event.stopPropagation()"')
  })

  it('lässt Escape zum window durch', () => {
    expect(html).toContain(`(keydown)="$event.key !== 'Escape' && $event.stopPropagation()"`)
  })
})
