import { describe, expect, it } from 'vitest'

import { type CloudStatusState, selectActiveBanner } from './cloud-status-banner.selector'

/** Basis-State: alles gesund, Tier 3 (Edge mit Cloud-Sync), keine Auffaelligkeit. */
const healthy = (): CloudStatusState => ({
  connectionStatus: 'authenticated',
  userSessionExpired: false,
  showsCloudSyncStatus: true,
  cloudNeedsRePairing: false,
  cloudTokenErrorReason: null,
  tokenLevel: 'ok',
  tokenRemainingSec: 10 * 3600,
  syncLevel: 'ok',
  syncAgeSec: 30,
  cloudUnreachable: false,
  offlineModeActive: false,
  offlineModeRemainingMin: 0,
  lastCloudContactAgeMin: 0,
})

describe('selectActiveBanner — Prioritaetsleiter', () => {
  it('gibt null zurueck, wenn alles gesund ist', () => {
    expect(selectActiveBanner(healthy())).toBeNull()
  })

  it('Screenshot-Case: pairing connected, Token abgelaufen, Sync warn, Cloud stale → token-expired', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      tokenLevel: 'crit',
      tokenRemainingSec: -120,
      syncLevel: 'warn',
      syncAgeSec: 12 * 60,
      cloudUnreachable: true,
      lastCloudContactAgeMin: 12,
    })
    expect(banner?.id).toBe('token-expired')
    expect(banner?.messageKey).toBe('CLOUD_STATUS.TOKEN_EXPIRED')
  })

  it('Re-Pairing schlaegt Token-abgelaufen (w90 > w70)', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      cloudNeedsRePairing: true,
      cloudTokenErrorReason: 'token-expired',
      tokenLevel: 'crit',
      tokenRemainingSec: -60,
    })
    expect(banner?.id).toBe('re-pairing-required')
    expect(banner?.sublineParams).toEqual({ reason: 'token-expired' })
  })

  it('client-offline schlaegt alles (w100)', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      connectionStatus: 'disconnected',
      cloudNeedsRePairing: true,
      tokenLevel: 'crit',
      tokenRemainingSec: -60,
      cloudUnreachable: true,
    })
    expect(banner?.id).toBe('client-offline')
    expect(banner?.action?.kind).toBe('reload')
  })

  it('client-offline wird bei abgelaufener Session unterdrueckt (Auth-Flow uebernimmt)', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      connectionStatus: 'error',
      userSessionExpired: true,
    })
    // Kein client-offline; Cloud-State gesund → kein Banner.
    expect(banner).toBeNull()
  })

  it('Offline-Modus aktiv schlaegt Token-abgelaufen + Cloud-unreachable (w80)', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      offlineModeActive: true,
      offlineModeRemainingMin: 47,
      tokenLevel: 'crit',
      tokenRemainingSec: -60,
      syncLevel: 'crit',
      syncAgeSec: 40 * 60,
    })
    expect(banner?.id).toBe('offline-mode-active')
    expect(banner?.sublineParams).toEqual({ minutes: 47 })
  })

  it('cloud-unreachable mit Action + Subline, wenn Token gueltig (w60)', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      cloudUnreachable: true,
      lastCloudContactAgeMin: 4,
      syncLevel: 'crit',
      syncAgeSec: 35 * 60,
    })
    expect(banner?.id).toBe('cloud-unreachable')
    expect(banner?.action?.kind).toBe('activate-offline-mode')
    expect(banner?.sublineParams).toEqual({ minutes: 4 })
  })

  it('token-expiring-soon nutzt Stunden-Key ab 60 min Rest', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      tokenLevel: 'warn',
      tokenRemainingSec: 3 * 3600,
    })
    expect(banner?.id).toBe('token-expiring-soon')
    expect(banner?.messageKey).toBe('CLOUD_STATUS.TOKEN_EXPIRES_IN_HOURS')
    expect(banner?.params).toEqual({ hours: 3 })
  })

  it('sync-stale (info-Level bei warn) als niedrigste Prioritaet', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      syncLevel: 'warn',
      syncAgeSec: 12 * 60,
    })
    expect(banner?.id).toBe('sync-stale')
    expect(banner?.level).toBe('info')
    expect(banner?.params).toEqual({ minutes: 12 })
  })

  it('kein Cloud-Banner ausserhalb Tier 3 (showsCloudSyncStatus=false)', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      showsCloudSyncStatus: false,
      tokenLevel: 'crit',
      tokenRemainingSec: -60,
      cloudUnreachable: true,
      syncLevel: 'crit',
      syncAgeSec: null,
    })
    expect(banner).toBeNull()
  })

  it('client-offline gilt auch ausserhalb Tier 3 (Edge nicht erreichbar)', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      showsCloudSyncStatus: false,
      connectionStatus: 'error',
    })
    expect(banner?.id).toBe('client-offline')
  })

  it('connect-offline ueberschreibt client-offline bei aktivem Offline-Cache', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      connectionStatus: 'error',
      offlineCacheActive: true,
    })
    expect(banner?.id).toBe('connect-offline')
    expect(banner?.level).toBe('warn')
    // Ohne ausstehende Outbox-Einträge: reiner TSE-/Bargeld-Hinweis, kein Zähler.
    expect(banner?.sublineKey).toBe('CLOUD_STATUS.CONNECT_OFFLINE_SUBLINE')
    expect(banner?.sublineParams).toBeUndefined()
  })

  it('connect-offline zeigt den Outbox-Zähler bei ausstehenden Einträgen', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      connectionStatus: 'disconnected',
      offlineCacheActive: true,
      outboxPendingCount: 3,
    })
    expect(banner?.id).toBe('connect-offline')
    expect(banner?.sublineKey).toBe('CLOUD_STATUS.CONNECT_OFFLINE_SUBLINE_PENDING')
    expect(banner?.sublineParams).toEqual({ count: 3 })
  })

  it('connect-offline weicht bei abgelaufener Session zurueck (Auth-Flow uebernimmt)', () => {
    const banner = selectActiveBanner({
      ...healthy(),
      connectionStatus: 'error',
      offlineCacheActive: true,
      userSessionExpired: true,
    })
    expect(banner).toBeNull()
  })
})
