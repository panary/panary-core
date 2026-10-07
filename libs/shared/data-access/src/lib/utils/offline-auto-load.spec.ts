import { describe, expect, it } from 'vitest'
import { AutoLoadState, shouldAutoLoad } from './offline-auto-load'

// core#649: Ein Stammdaten-Service laedt offline aus dem Cache und nach dem Reconnect neu.
const state = (overrides: Partial<AutoLoadState>): AutoLoadState => ({
  isAuthenticated: false,
  isLoaded: false,
  loadedFromCache: false,
  cacheReady: false,
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

  it('laedt offline aus dem bereiten Cache — genau einmal', () => {
    expect(shouldAutoLoad(state({ cacheReady: true }))).toBe(true)
    expect(shouldAutoLoad(state({ cacheReady: true, isLoaded: true, loadedFromCache: true }))).toBe(false)
  })

  it('laedt offline ohne bereiten Cache nicht (Cloud-/Admin-Frontends unveraendert)', () => {
    expect(shouldAutoLoad(state({}))).toBe(false)
  })
})
