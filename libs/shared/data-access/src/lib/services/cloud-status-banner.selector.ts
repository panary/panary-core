/**
 * Priorisierte Auswahl EINES Cloud-Status-Banners.
 *
 * Statt mehrerer gleichzeitig gestapelter Banner (Offline, Re-Pairing, Sync-Alter,
 * Token-Ablauf …) wird genau der Zustand mit der hoechsten Gewichtung angezeigt.
 * Die Leiter bildet die Kausalitaet ab: eine Wurzelursache (kein Edge-Kontakt →
 * Re-Pairing noetig → Token abgelaufen → Cloud nicht erreichbar) unterdrueckt die
 * nachgelagerten Symptome (Sync-Alter).
 *
 * Diese Funktion ist bewusst PURE (kein DI, keine Signals) — der
 * `CloudStatusBannerService` wrappt sie in ein `computed()`. So ist die gesamte
 * Prioritaetslogik ohne Angular-TestBed unit-testbar.
 */

export type CloudBannerLevel = 'crit' | 'warn' | 'info'
export type CloudBannerActionKind = 'reload' | 'activate-offline-mode'

export interface CloudBannerAction {
  kind: CloudBannerActionKind
  /** i18n-Key des Button-Labels. */
  labelKey: string
}

export interface CloudBanner {
  /** Stabile ID des Banner-Zustands (fuer trackBy / Tests). */
  id: string
  level: CloudBannerLevel
  /** material-symbols-Icon-Name. */
  icon: string
  /** i18n-Key der Hauptnachricht. */
  messageKey: string
  params?: Record<string, string | number>
  /** Optionale zweite Zeile (Erklaerung). */
  sublineKey?: string
  sublineParams?: Record<string, string | number>
  /** Optionale Handlungsaktion (Reload bzw. Offline-Modus aktivieren). */
  action?: CloudBannerAction
}

/** Flacher Eingabe-State — gespeist aus den `ConnectionService`-Signals. */
export interface CloudStatusState {
  // Client ↔ Edge (WebSocket)
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'authenticated' | 'error'
  /** WS-Auth wurde mit 401 abgelehnt → Auth-Flow uebernimmt (Login-Redirect). */
  userSessionExpired: boolean
  /** Connect-Tier: Offline-Cache aktiv → der POS arbeitet offline weiter (Cache + Outbox). */
  offlineCacheActive?: boolean
  /** Anzahl noch ausstehender Outbox-Einträge (offline erzeugte Mutationen). */
  outboxPendingCount?: number
  // Tier-3-Gate (Edge mit Cloud-Sync)
  showsCloudSyncStatus: boolean
  // Edge ↔ Cloud
  cloudNeedsRePairing: boolean
  cloudTokenErrorReason: string | null
  tokenLevel: 'ok' | 'warn' | 'crit'
  tokenRemainingSec: number | null
  syncLevel: 'ok' | 'warn' | 'crit'
  syncAgeSec: number | null
  cloudUnreachable: boolean
  offlineModeActive: boolean
  offlineModeRemainingMin: number
  lastCloudContactAgeMin: number | null
}

/**
 * Waehlt den hoechstpriorisierten aktiven Banner.
 * Reihenfolge = Gewichtung (oben = hoechste). Erster Treffer gewinnt; kein
 * Treffer → `null` (kein Banner).
 */
export function selectActiveBanner(s: CloudStatusState): CloudBanner | null {
  // 0. (w110) Connect-Tier offline MIT aktivem Offline-Cache — der POS arbeitet
  //    weiter (Cache + Outbox). Andere Botschaft als das generische client-offline:
  //    kein Reload, sondern Bargeld-/Nachreich-Hinweis. NICHT bei abgelaufener Session.
  if (
    s.offlineCacheActive &&
    (s.connectionStatus === 'disconnected' || s.connectionStatus === 'error') &&
    !s.userSessionExpired
  ) {
    const pending = s.outboxPendingCount ?? 0
    return {
      id: 'connect-offline',
      level: 'warn',
      icon: 'wifi_off',
      messageKey: 'CLOUD_STATUS.CONNECT_OFFLINE',
      // Mit ausstehenden Bestellungen den Zähler zeigen; sonst der reine TSE-/Bargeld-Hinweis.
      sublineKey: pending > 0 ? 'CLOUD_STATUS.CONNECT_OFFLINE_SUBLINE_PENDING' : 'CLOUD_STATUS.CONNECT_OFFLINE_SUBLINE',
      ...(pending > 0 ? { sublineParams: { count: pending } } : {}),
    }
  }

  // 1. (w100) Client offline — Edge nicht erreichbar. Unterdrueckt alle
  //    Cloud-Aussagen (deren /health-State ist dann ohnehin veraltet).
  //    NICHT bei abgelaufener Session: dort macht der Auth-Flow den Redirect.
  if ((s.connectionStatus === 'disconnected' || s.connectionStatus === 'error') && !s.userSessionExpired) {
    return {
      id: 'client-offline',
      level: 'crit',
      icon: 'wifi_off',
      messageKey: 'CLOUD_STATUS.CLIENT_OFFLINE',
      action: { kind: 'reload', labelKey: 'CLOUD_STATUS.RELOAD' },
    }
  }

  // Cloud-Banner (2–8) nur in Tier 3 (Edge mit Cloud-Sync).
  if (s.showsCloudSyncStatus) {
    // 2. (w90) Re-Pairing erforderlich — Cloud hat den Edge-Token abgelehnt.
    if (s.cloudNeedsRePairing) {
      return {
        id: 're-pairing-required',
        level: 'crit',
        icon: 'cloud_off',
        messageKey: 'CLOUD_STATUS.REPAIRING_REQUIRED',
        ...(s.cloudTokenErrorReason
          ? { sublineKey: 'CLOUD_STATUS.REPAIRING_REASON', sublineParams: { reason: s.cloudTokenErrorReason } }
          : {}),
      }
    }

    // 3. (w80) Offline-Modus aktiv — vom Operator bewusst gesetzt; der Countdown
    //    darf nicht vom Symptom (Token/Unreachable) verdeckt werden.
    if (s.offlineModeActive) {
      return {
        id: 'offline-mode-active',
        level: 'warn',
        icon: 'cloud_off',
        messageKey: 'CLOUD_STATUS.OFFLINE_MODE_ACTIVE',
        sublineKey: 'CLOUD_STATUS.OFFLINE_MODE_ACTIVE_SUBLINE',
        sublineParams: { minutes: s.offlineModeRemainingMin },
      }
    }

    // 4. (w70) Token abgelaufen — Re-Pairing noetig (Pairing evtl. noch 'connected').
    if (s.tokenLevel === 'crit' && s.tokenRemainingSec !== null && s.tokenRemainingSec <= 0) {
      return {
        id: 'token-expired',
        level: 'crit',
        icon: 'key',
        messageKey: 'CLOUD_STATUS.TOKEN_EXPIRED',
      }
    }

    // 5. (w60) Cloud nicht erreichbar — Bestellungen blockiert, Offline-Modus moeglich.
    if (s.cloudUnreachable) {
      return {
        id: 'cloud-unreachable',
        level: 'crit',
        icon: 'cloud_off',
        messageKey: 'CLOUD_STATUS.CLOUD_UNREACHABLE',
        sublineKey: 'CLOUD_STATUS.ORDERS_BLOCKED',
        ...(s.lastCloudContactAgeMin !== null ? { sublineParams: { minutes: s.lastCloudContactAgeMin } } : {}),
        action: { kind: 'activate-offline-mode', labelKey: 'CLOUD_STATUS.ACTIVATE_OFFLINE_MODE' },
      }
    }

    // 6. (w40) Token laeuft bald ab — Vorlaufwarnung.
    if (s.tokenLevel === 'warn') {
      const minutes = s.tokenRemainingSec !== null ? Math.floor(s.tokenRemainingSec / 60) : 0
      const useHours = minutes >= 60
      return {
        id: 'token-expiring-soon',
        level: 'warn',
        icon: 'key',
        messageKey: useHours ? 'CLOUD_STATUS.TOKEN_EXPIRES_IN_HOURS' : 'CLOUD_STATUS.TOKEN_EXPIRES_IN_MINUTES',
        params: useHours ? { hours: Math.floor(minutes / 60) } : { minutes },
      }
    }

    // 7./8. (w30/w20) Sync veraltet — rein informativ (niedrigste Prioritaet).
    if (s.syncLevel === 'crit' || s.syncLevel === 'warn') {
      const level: CloudBannerLevel = s.syncLevel === 'crit' ? 'warn' : 'info'
      if (s.syncAgeSec === null) {
        return { id: 'sync-stale', level, icon: 'cloud_sync', messageKey: 'CLOUD_STATUS.SYNC_NEVER' }
      }
      const minutes = Math.floor(s.syncAgeSec / 60)
      const useHours = minutes >= 60
      return {
        id: 'sync-stale',
        level,
        icon: 'cloud_sync',
        messageKey: useHours ? 'CLOUD_STATUS.SYNC_AGE_HOUR' : 'CLOUD_STATUS.SYNC_AGE_MIN',
        params: useHours ? { hours: Math.floor(minutes / 60) } : { minutes },
      }
    }
  }

  return null
}
