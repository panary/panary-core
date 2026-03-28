import { describe, it, expect } from 'vitest'
import { UpdateService } from './update.service'

describe('UpdateService', () => {
  it('sollte initial kein Update anzeigen', () => {
    const service = new UpdateService()
    expect(service.hasUpdate()).toBe(false)
    expect(service.updateAvailable()).toBeNull()
    expect(service.isChecking()).toBe(false)
    expect(service.isDownloading()).toBe(false)
    expect(service.downloadProgress()).toBe(0)
  })

  it('sollte periodische Checks im Browser-Modus ignorieren', () => {
    const service = new UpdateService()
    // Im Browser-Modus (kein __TAURI_INTERNALS__) sollte startPeriodicCheck ein No-Op sein
    service.startPeriodicCheck()
    // Kein Fehler = Erfolg
    service.stopPeriodicCheck()
  })
})
