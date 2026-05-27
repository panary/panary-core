import { logger } from '@panary/shared-backend'
import { resolveTseProvider, SimulatorTseAdapter, TseError, type TsePort } from '@panary/tse/domain'

import type { Application } from '../../declarations'

// Erzeugt den TSE-Port anhand der App-Konfiguration (`app.get('tse')`).
//
// Gibt `undefined` zurück, wenn TSE nicht aktiv ist (z. B. Produktion ohne
// konfigurierten echten Provider) — bestehende Deployments ohne TSE bleiben
// unberührt. Wirft beim Bootstrap, wenn ein Simulator in Produktion erzwungen
// wird (fail-closed), oder wenn ein noch nicht implementierter Provider
// konfiguriert ist.
export const createTsePort = (app: Application): TsePort | undefined => {
  const configured = app.get('tse')?.provider
  const provider = resolveTseProvider(configured, process.env['NODE_ENV'] === 'production')
  if (!provider) return undefined

  if (provider === 'simulator') {
    logger.warn({
      message: 'TSE-Simulator aktiv — erzeugte Signaturen sind NICHT fiskalisch gültig',
      event: 'tse.simulator_active',
    })
    return new SimulatorTseAdapter()
  }

  // Echte Provider (z. B. Fiskaly) folgen in einer eigenen Phase.
  throw new TseError(`TSE-Provider '${provider}' ist noch nicht implementiert.`, 'TSE_PROVIDER_NOT_IMPLEMENTED')
}
