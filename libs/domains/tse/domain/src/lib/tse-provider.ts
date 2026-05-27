import { TseError } from './tse.errors'

export type TseProviderId = 'simulator' | 'fiskaly'

// Ermittelt den zu nutzenden TSE-Provider aus der (optionalen) Konfiguration.
//
// Regeln (fail-closed):
// - Ohne explizite Konfiguration: in Nicht-Produktion `simulator` (bequeme
//   lokale Entwicklung), in Produktion `undefined` → TSE inaktiv. Das bricht
//   bestehende Produktions-Deployments OHNE TSE bewusst NICHT.
// - Ein `simulator` in Produktion ist NIEMALS zulässig (würde nicht-fiskalische
//   Belege erzeugen) → harter Fehler.
// - Unbekannte Provider → harter Fehler.
export const resolveTseProvider = (
  configuredProvider: string | undefined,
  isProduction: boolean,
): TseProviderId | undefined => {
  const provider = configuredProvider ?? (isProduction ? undefined : 'simulator')
  if (!provider) return undefined

  if (provider === 'simulator' && isProduction) {
    throw new TseError(
      'TSE-Simulator ist in Produktion nicht zulässig — tse.provider muss ein echter Provider sein.',
      'TSE_SIMULATOR_FORBIDDEN_IN_PROD',
    )
  }
  if (provider !== 'simulator' && provider !== 'fiskaly') {
    throw new TseError(`Unbekannter TSE-Provider: ${provider}`, 'TSE_UNKNOWN_PROVIDER')
  }
  return provider
}

// Mappt den am Tenant gespeicherten Provider (`tenant.tse.provider`, Großschreib-
// Enum aus `@panary/tenants/domain` — FISKALY/SWISSBIT/EPSON/…) auf die
// TsePort-Provider-Id. Geteilt von Edge- und Cloud-Factory, damit die per-Tenant-
// Provider-Auswahl an EINER Stelle definiert ist (kein Drift).
//
// Aktuell ist nur ein (künftiger) `fiskaly`-Adapter vorgesehen → `FISKALY` mappt
// auf `'fiskaly'`, alle anderen auf `undefined` (kein implementierter Adapter →
// der Aufrufer fällt auf die Config/Simulator zurück bzw. lässt TSE inaktiv).
export const tseProviderFromTenant = (tenantProvider: string | undefined | null): TseProviderId | undefined => {
  switch (tenantProvider) {
    case 'FISKALY':
      return 'fiskaly'
    default:
      return undefined
  }
}
