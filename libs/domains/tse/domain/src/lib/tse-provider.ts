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
