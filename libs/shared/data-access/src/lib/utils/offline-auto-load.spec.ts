import { describe, expect, it } from 'vitest'
import { AutoLoadState, shouldAutoLoad } from './offline-auto-load'

// core#649: Ein Stammdaten-Service laedt offline aus dem Cache und nach dem Reconnect neu.
const state = (overrides: Partial<AutoLoadState>): AutoLoadState => ({
  isAuthenticated: false,
  readsFromCache: false,
  isLoaded: false,
  loadedFromCache: false,
  ...overrides,
})

describe('shouldAutoLoad', () => {
  it('laedt online, solange nichts geladen ist', () => {
    expect(shouldAutoLoad(state({ isAuthenticated: true }))).toBe(true)
    expect(shouldAutoLoad(state({ isAuthenticated: true, isLoaded: true }))).toBe(false)
  })

  it('laedt nach dem Reconnect neu, wenn der Stand aus dem Cache kam', () => {
    expect(shouldAutoLoad(state({ isAuthenticated: true, isLoaded: true, loadedFromCache: true }))).toBe(true)
  })

  it('laedt offline aus dem Cache — genau einmal', () => {
    expect(shouldAutoLoad(state({ readsFromCache: true }))).toBe(true)
    expect(shouldAutoLoad(state({ readsFromCache: true, isLoaded: true, loadedFromCache: true }))).toBe(false)
  })

  it('liest der Cache trotz Authentifizierung (Verbindungsfehler), laedt es nicht wiederholt', () => {
    expect(
      shouldAutoLoad(state({ isAuthenticated: true, readsFromCache: true, isLoaded: true, loadedFromCache: true })),
    ).toBe(false)
  })

  it('wartet, solange der Socket verbunden, das Geraet aber nicht authentifiziert ist', () => {
    expect(shouldAutoLoad(state({}))).toBe(false)
  })
})
