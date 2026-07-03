import { describe, expect, it, vi } from 'vitest'
import { createEnsureLoaded } from './ensure-loaded'

// Locken die Idempotenz-Garantien von ensureLoaded() (On-Demand-Alternative zum
// Auto-Load, s. DATA_ACCESS_AUTO_LOAD): kein Re-Load nach Erfolg, Dedup paralleler
// Aufrufe, Retry-Fähigkeit solange isLoaded false bleibt.

describe('createEnsureLoaded', () => {
  it('lädt beim ersten Aufruf und nie wieder, sobald isLoaded true liefert', async () => {
    let loaded = false
    const load = vi.fn(async (): Promise<void> => {
      loaded = true
    })
    const ensureLoaded = createEnsureLoaded(() => loaded, load)

    await ensureLoaded()
    await ensureLoaded()
    await ensureLoaded()

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('dedupliziert parallele Aufrufe auf einen einzigen laufenden Load', async () => {
    let resolveLoad: () => void = () => undefined
    const load = vi.fn(
      () =>
        new Promise<void>(resolve => {
          resolveLoad = resolve
        }),
    )
    const ensureLoaded = createEnsureLoaded(() => false, load)

    const first = ensureLoaded()
    const second = ensureLoaded()
    resolveLoad()
    await Promise.all([first, second])

    expect(load).toHaveBeenCalledTimes(1)
  })

  it('lädt erneut, solange isLoaded false bleibt (z. B. Load ohne Geschäftstag/fehlgeschlagen)', async () => {
    const load = vi.fn(async (): Promise<void> => undefined)
    const ensureLoaded = createEnsureLoaded(() => false, load)

    await ensureLoaded()
    await ensureLoaded()

    expect(load).toHaveBeenCalledTimes(2)
  })

  it('reicht eine Rejection an den Aufrufer weiter und erlaubt danach einen Retry', async () => {
    const load = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(undefined)
    const ensureLoaded = createEnsureLoaded(() => false, load)

    await expect(ensureLoaded()).rejects.toThrow('offline')
    await expect(ensureLoaded()).resolves.toBeUndefined()
    expect(load).toHaveBeenCalledTimes(2)
  })
})
