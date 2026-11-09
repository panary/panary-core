// Mandantensperre, wie der Edge sie aus `/sync-pull` erfährt (panary/panary-core#1401).
//
// Die Cloud lehnt Daten-Sync eines gesperrten Mandanten mit `403 TENANT_SUSPENDED` ab
// (panary-cloud `assert-tenant-active.ts`, `data: { code, tenantStatus }`). Der POS im
// Edge-Tier spricht nie selbst mit der Cloud und erfuhr die Sperre deshalb gar nicht.
// Der Edge merkt sich den letzten Befund im Prozess und meldet ihn über `/health`, das
// der POS ohnehin pollt.
//
// Drei Zustände, weil der POS sie unterscheiden muss:
//   - `undefined`: seit dem Start kein auswertbarer Pull → unbekannt, der POS ändert nichts
//   - `null`: der letzte Pull lief durch → nicht gesperrt
//   - Objekt: der letzte Pull bekam 403 TENANT_SUSPENDED
// Bewusst nur im Speicher: keine Migration, und nach einem Neustart klärt der nächste
// Pull den Zustand wieder.

import type { Application } from '../declarations'

/** Code des Cloud-Guards `assertTenantNotSuspended`. */
export const TENANT_SUSPENDED_CODE = 'TENANT_SUSPENDED'

export interface CloudTenantSuspension {
  /** `SUSPENDED`, `ARCHIVED` oder `null`, wenn die Cloud keinen Status mitliefert. */
  tenantStatus: string | null
  /** Zeitpunkt des letzten 403 (ISO 8601). */
  detectedAt: string
}

/**
 * Liest eine Cloud-Fehlerantwort als Mandantensperre. Nur 403 mit `data.code` bzw. dem
 * Message-Präfix `TENANT_SUSPENDED:` zählt — ein generischer 403 sagt nichts über den Mandanten.
 */
export const readCloudTenantSuspension = (status: number, rawBody: string): { tenantStatus: string | null } | null => {
  if (status !== 403) return null
  let parsed: { message?: unknown; data?: unknown } | null
  try {
    parsed = JSON.parse(rawBody) as { message?: unknown; data?: unknown } | null
  } catch {
    return null
  }
  const data = parsed?.data as { code?: unknown; tenantStatus?: unknown } | null | undefined
  const viaData = data !== null && typeof data === 'object' && data.code === TENANT_SUSPENDED_CODE
  const viaMessage = typeof parsed?.message === 'string' && parsed.message.startsWith(`${TENANT_SUSPENDED_CODE}:`)
  if (!viaData && !viaMessage) return null
  return { tenantStatus: typeof data?.tenantStatus === 'string' ? data.tenantStatus : null }
}

export const markCloudTenantSuspended = (app: Application, tenantStatus: string | null): void => {
  app.set('cloudTenantSuspension', { tenantStatus, detectedAt: new Date().toISOString() })
}

export const clearCloudTenantSuspension = (app: Application): void => {
  app.set('cloudTenantSuspension', null)
}

/** `undefined` = unbekannt, `null` = nicht gesperrt, Objekt = gesperrt (siehe Dateikopf). */
export const getCloudTenantSuspension = (app: Application): CloudTenantSuspension | null | undefined =>
  app.get('cloudTenantSuspension')

/**
 * Feld `cloudTenantSuspension` des öffentlichen `/health`: nur der Status, kein Zeitstempel.
 * `undefined` lässt das Feld in der JSON-Antwort weg — der POS liest das als „unbekannt".
 */
export const tenantSuspensionForHealth = (app: Application): { tenantStatus: string | null } | null | undefined => {
  const state = getCloudTenantSuspension(app)
  if (state === undefined) return undefined
  return state === null ? null : { tenantStatus: state.tenantStatus }
}
