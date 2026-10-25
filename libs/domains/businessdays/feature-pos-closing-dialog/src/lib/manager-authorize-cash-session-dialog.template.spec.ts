import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// core#955: Bei 1366×768 war der PIN-Schritt 51 px zu hoch (Inhalt 542 px bei 491 px sichtbar), die letzte
// Tastenreihe lag unter dem Fuß. Die Specs rendern kein Layout — die wirksame Höhe ist im Browser gemessen
// (Sandbox, danach 462 px bei 462 px). Hier gesichert ist, woraus die Ersparnis kommt, und dass die Tasten ihr
// Touch-Maß behalten, ohne dass eine globale Mindesthöhe sie wieder wachsen lässt (Lehre aus core#928).
const template = readFileSync(
  fileURLToPath(new URL('./manager-authorize-cash-session-dialog.component.html', import.meta.url)),
  'utf8',
)
const styles = readFileSync(
  fileURLToPath(new URL('../../../../../../apps/pos-client/src/styles.scss', import.meta.url)),
  'utf8',
)

const start = template.indexOf("@case ('enter-pin')")
const pinStep = template.slice(start, template.indexOf("@case ('submitting')", start))
const classesOf = (tag: string) => tag.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? []

describe('Kassenfreigabe — PIN-Schritt passt in 1366×768 (core#955)', () => {
  it('stellt Avatar, Name und Rolle in eine Zeile statt untereinander', () => {
    const avatar = pinStep.indexOf("{{ manager.initials || '??' }}")
    const kopf = pinStep.lastIndexOf('<div class="flex', pinStep.lastIndexOf('<div', avatar) - 1)
    const kopfKlassen = classesOf(pinStep.slice(kopf, pinStep.indexOf('>', kopf) + 1))

    expect(avatar).toBeGreaterThan(-1)
    expect(kopfKlassen).toContain('items-center')
    expect(kopfKlassen).not.toContain('flex-col')
  })

  it('hält den Abstand zwischen den Blöcken bei höchstens gap-4', () => {
    const schritt = classesOf(pinStep.slice(pinStep.indexOf('<div class="flex flex-col items-center')))
    const gap = Number(schritt.map(k => k.match(/^gap-(\d+)$/)?.[1]).find(Boolean))

    expect(gap).toBeGreaterThan(0)
    expect(gap).toBeLessThanOrEqual(4)
  })

  it('lässt die PIN-Tasten bei 3,5rem, ohne globale Mindesthöhe darüber', () => {
    const tasten = [...pinStep.matchAll(/<button[^>]*class="([^"]*)"/g)].map(m => m[1].split(/\s+/))
    const mindesthoehe = (klasse: string) =>
      Number(styles.match(new RegExp(`\\.${klasse}\\s*\\{[^}]*min-height:\\s*max\\(([\\d.]+)rem`))?.[1] ?? 0)

    // Vier Tags: die Ziffern 1–9 im @for, dazu Zurück, 0 und Löschen.
    expect(tasten).toHaveLength(4)
    expect(tasten.filter(k => !k.includes('h-14'))).toEqual([])
    expect(tasten.flat().filter(k => mindesthoehe(k) > 3.5)).toEqual([])
  })
})
