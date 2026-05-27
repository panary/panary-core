// Naht für die Auflösung von TSE-Provider-Credentials. `tenant.tse.apiKeyRef` /
// `apiSecretRef` sind bewusst nur REFERENZEN (BWS-Secret-IDs bzw. AES-Chiffrat-
// Handles), niemals Klartext — gesynct werden ausschließlich diese Referenzen.
// Erst kurz vor dem Provider-Call löst der jeweilige Resolver die Referenz in den
// Klartext auf:
//   - Cloud: AES-Chiffrat aus der DB via secret-cipher (Master-Key aus BWS).
//   - Edge:  direkter BWS-Abruf (Machine-Account).
//
// Implementierungen leben in den Apps (Cloud/Edge), weil sie umgebungs-spezifische
// Backends nutzen. Konsument ist der echte Provider-Adapter (z. B. FiskalyAdapter)
// — bis dieser existiert, ist die Naht ungenutzt (Simulator braucht keine Secrets).
// Siehe ADR fiskalisierung-architektur-adr.md.

/** Aufgelöste TSE-Credentials (Klartext) — niemals persistieren oder loggen. */
export interface TseResolvedCredentials {
  apiKey: string
  apiSecret: string
}

/** Wird geworfen, wenn das Secret-Backend nicht verfügbar/konfiguriert ist. */
export class TseSecretResolverUnavailable extends Error {
  readonly code = 'TSE_SECRET_RESOLVER_UNAVAILABLE'
  constructor(message = 'TSE-Secret-Resolver nicht verfügbar') {
    super(message)
    this.name = 'TseSecretResolverUnavailable'
  }
}

export interface TseSecretResolver {
  /**
   * Löst die gespeicherten Referenzen (`apiKeyRef`/`apiSecretRef`) in den Klartext
   * auf. Wirft `TseSecretResolverUnavailable`, wenn das Backend fehlt — der
   * Aufrufer (Adapter-Factory) behandelt das fail-closed (kein Real-Provider).
   */
  resolve(refs: { apiKeyRef?: string; apiSecretRef?: string }): Promise<TseResolvedCredentials>
}
