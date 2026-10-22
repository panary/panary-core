import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Tailwind-Farbklassen der alten Palette; Primär- und Akzentfarben kommen aus den App-Tokens (ADR 0058). */
const ALTE_PALETTE = /\b[\w:-]*-(?:indigo|violet|purple)-\d{2,3}\b/g

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// core#894: Einstellungen und Entkoppeln-Dialog zeigten nach dem Token-Umbau noch Violett.
describe('Einstellungen nutzen die App-Tokens (core#894)', () => {
  it.each(['./settings.component.html', './unpair-device-dialog/unpair-device-dialog.component.html'])(
    '%s enthält keine Indigo-/Violett-Klassen',
    file => {
      expect(read(file).match(ALTE_PALETTE) ?? []).toEqual([])
    },
  )
})
