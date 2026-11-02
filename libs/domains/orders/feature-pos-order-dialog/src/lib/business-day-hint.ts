/**
 * Hinweis auf einen fehlenden Geschäftstag im Bestelldialog (panary/panary-core#1171).
 *
 * Am cloud-direkten POS lehnte die Cloud eine fertig aufgebaute Bestellung erst beim Absenden mit „kein
 * Geschäftstag eröffnet" ab. Der Hinweis zeigt das vorher, sperrt aber nichts: Das Absenden scheitert wie
 * bisher mit der Server-Meldung.
 *
 * Die Zweige spiegeln den Server, nicht die Betriebsart allein:
 * - `cloud-direct`: Die Cloud eröffnet keinen Tag von selbst, der POS kann es per `openDay` → `open-here`.
 * - Edge mit Pairing `connected` ohne Offline-Override: Die Edge rotiert nicht selbst und lehnt externes
 *   `openDay` ab (`guardCloudManagedLifecycle`) → `open-in-admin`, ohne Knopf.
 * - Edge ohne Pairing oder mit Override: Die erste Bestellung legt den Tag an
 *   (`restrict-order-to-business-day.ts`, `localRotationAllowed`) → kein Hinweis.
 *
 * Offline gibt es keinen Hinweis: Bestellungen laufen in die Outbox, und Eröffnen braucht eine Verbindung.
 */
export type BusinessDayHint = 'open-here' | 'open-in-admin' | null

export interface BusinessDayHintState {
  /** Mindestens ein `/health`-Roundtrip war erfolgreich — vorher ist die Betriebsart unbekannt. */
  healthLoaded: boolean
  tier: 'cloud-direct' | 'standalone' | 'edge-with-cloud' | 'unknown'
  /** Pairing der Edge steht auf `connected` (`ConnectionService.cloudPaired`). */
  cloudPaired: boolean
  /** Offline-Override der Edge ist aktiv: Sie rotiert dann trotz Pairing selbst. */
  offlineOverrideActive: boolean
  /** Socket verbunden (`connected` oder `authenticated`), wie `PosSessionService.isOffline`. */
  online: boolean
  /** Filiale geladen — sonst steht das Sperr-Overlay `blockingReason`, ein Hinweis darunter wäre unsichtbar. */
  locationLoaded: boolean
  /** Dasselbe Prädikat wie der Mehr-Menü-Eintrag: `currentBusinessDay.businessDayId` gesetzt. */
  businessDayOpen: boolean
}

export function businessDayHint(state: BusinessDayHintState): BusinessDayHint {
  if (!state.healthLoaded || !state.locationLoaded || !state.online || state.businessDayOpen) return null
  if (state.tier === 'cloud-direct') return 'open-here'
  if (state.cloudPaired && !state.offlineOverrideActive) return 'open-in-admin'
  return null
}
