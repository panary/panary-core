import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Tailwind-Farbklassen der alten Palette; Primär- und Akzentfarben kommen aus den App-Tokens (ADR 0058). */
const ALTE_PALETTE = /\b[\w:-]*-(?:indigo|violet|purple)-\d{2,3}\b/g

// core#894: „Neue Vorbestellung" und „Bestellung erstellen" waren nach dem Token-Umbau noch Indigo.
describe('Vorbestellungen nutzen die App-Tokens (core#894)', () => {
  it('das Template enthält keine Indigo-/Violett-Klassen', () => {
    const source = readFileSync(fileURLToPath(new URL('./pre-order-list.component.ts', import.meta.url)), 'utf8')
    expect(source.match(ALTE_PALETTE) ?? []).toEqual([])
  })

  it('die Primärtasten sind Mint mit Navy-Schrift', () => {
    const source = readFileSync(fileURLToPath(new URL('./pre-order-list.component.ts', import.meta.url)), 'utf8')
    expect(source.match(/bg-action text-on-action/g)?.length).toBe(4)
  })
})
