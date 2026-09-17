/**
 * Boot-Schutzschichten des Edge (panary/panary-core#323).
 *
 * Zwei unabhaengige Loecher, beide vor dem Start der Feathers-App zu schliessen:
 *
 *  1. `panary.config.json` wurde bisher Schluessel fuer Schluessel nach
 *     `process.env` uebertragen — ohne Allowlist. Da die Datei vom
 *     unauthentifizierten Setup-Endpunkt geschrieben wird, war jede
 *     Umgebungsvariable des Prozesses durch den Aufrufer bestimmbar,
 *     einschliesslich `FEATHERS_SECRET`. `filterConfigEnv` dreht das um:
 *     uebertragen wird nur, was ausdruecklich erlaubt ist.
 *  2. `FEATHERS_SECRET` hatte einen Platzhalter-Default im oeffentlichen Repo.
 *     `assertFeathersSecret` laesst den Edge gar nicht erst starten, statt JWTs
 *     mit einem bekannten Schluessel zu signieren.
 */

/**
 * Der frueher in `config/default.json` ausgelieferte Platzhalter. Steht im
 * oeffentlichen Repo und ist damit kein Geheimnis — wer ihn benutzt, hat kein
 * Secret, sondern eine Einladung. Bleibt hier stehen, damit eine
 * Bestandsinstallation, die ihn in ihre Config kopiert hat, beim Boot
 * namentlich erkannt und gemeldet wird.
 */
export const FEATHERS_SECRET_PLACEHOLDER = 'CHANGE_ME_IN_PRODUCTION'

/**
 * Untergrenze in Zeichen. `install.sh` erzeugt `openssl rand -base64 32`
 * (44 Zeichen); 32 laesst handgesetzte Secrets zu, ohne ein Wort durchgehen
 * zu lassen.
 */
export const FEATHERS_SECRET_MIN_LENGTH = 32

/**
 * Schluessel, die aus `panary.config.json` nach `process.env` uebertragen
 * werden duerfen. Bewusst kurz: Jeder Eintrag hier ist eine Variable, die der
 * Setup-Endpunkt setzen kann.
 *
 * 🚫 Nicht aufnehmen: `FEATHERS_SECRET`, `EDGE_TOKEN_ENCRYPTION_KEY`,
 * `ADMIN_*` und alles, was Pfade oder den Node-Start beeinflusst — sonst ist
 * die Allowlist wieder der Generalschluessel, den sie ersetzen soll.
 */
export const CONFIG_ENV_ALLOWLIST: readonly string[] = ['HOSTNAME', 'LOG_DIR', 'PORT', 'SYSTEM_MODE', 'TZ']

/**
 * Ausdruecklich verbotene Schluessel. Technisch redundant — die Allowlist
 * laesst sie ohnehin nicht durch —, aber die Liste dokumentiert die Absicht
 * und laesst einen Treffer als eigenen Log-Eintrag auffallen: Wer hier
 * anklopft, probiert nicht herum, sondern zielt.
 *
 * Die Node-Schalter greifen nachtraeglich gesetzt ohnehin nicht mehr (der
 * Prozess laeuft bereits); sie stehen hier, damit niemand sie spaeter
 * arglos auf die Allowlist setzt.
 */
export const CONFIG_ENV_DENYLIST: readonly string[] = [
  'ADMIN_EMAIL',
  'ADMIN_LOGIN',
  'ADMIN_PASSWORD',
  'EDGE_TOKEN_ENCRYPTION_KEY',
  'FEATHERS_SECRET',
  'LD_LIBRARY_PATH',
  'LD_PRELOAD',
  'NODE_CONFIG_DIR',
  'NODE_ENV',
  'NODE_EXTRA_CA_CERTS',
  'NODE_OPTIONS',
  'PANARY_CONFIG_PATH',
  'PATH',
  'SETUP_CLIENT_PATH',
]

/**
 * Schluessel des Setup-Payloads. Sie gehoeren in die Config-Datei, sind aber
 * nie fuer `process.env` bestimmt — `main.ts` liest sie direkt als `config.x`.
 * Ohne diese Liste meldete jeder normale Boot sie als "verworfen" und die
 * Warnung waere Rauschen statt Signal.
 */
const CONFIG_PAYLOAD_KEYS: readonly string[] = [
  'adminEmail',
  'adminLogin',
  'adminPassword',
  'businessType',
  'locationName',
  'mode',
  'shopName',
]

export interface ConfigEnvFilterResult {
  /** Schluessel/Wert-Paare, die nach `process.env` gehoeren. */
  applied: Record<string, string>
  /** Unbekannte Schluessel — verworfen, werden gemeldet. */
  rejected: string[]
  /** Treffer auf der Denyliste — verworfen, werden gesondert gemeldet. */
  denied: string[]
}

/**
 * Entscheidet je Config-Schluessel, ob er nach `process.env` darf.
 *
 * Nur Skalare kommen ueberhaupt in Frage (wie bisher) — verschachtelte Objekte
 * hatten noch nie eine sinnvolle String-Darstellung als Umgebungsvariable.
 */
export function filterConfigEnv(config: Record<string, unknown>): ConfigEnvFilterResult {
  const allowed = new Set(CONFIG_ENV_ALLOWLIST)
  const denied = new Set(CONFIG_ENV_DENYLIST)
  const payload = new Set(CONFIG_PAYLOAD_KEYS)

  const result: ConfigEnvFilterResult = { applied: {}, rejected: [], denied: [] }

  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') continue

    if (allowed.has(key)) {
      result.applied[key] = String(value)
      continue
    }
    if (denied.has(key)) {
      result.denied.push(key)
      continue
    }
    // Erwartete Payload-Felder still uebergehen — sie werden direkt gelesen.
    if (payload.has(key)) continue

    result.rejected.push(key)
  }

  return result
}

/**
 * Prueft das JWT-Signatur-Secret und wirft, wenn es fehlt, der Platzhalter ist
 * oder zu kurz. Der Aufrufer bricht den Boot damit ab — ein Edge, der mit
 * einem bekannten Schluessel signiert, ist schlimmer als ein Edge, der steht:
 * Der stehende faellt auf.
 *
 * Die Meldung nennt den Behebungsweg, weil sie im Container-Log eines Geraets
 * landet, vor dem niemand sitzt.
 */
export function assertFeathersSecret(secret: unknown): asserts secret is string {
  const hint =
    'Behebung: FEATHERS_SECRET in der .env des Edge setzen ' +
    '(z. B. `openssl rand -base64 32`) und den Container neu starten. ' +
    'Der Installer get.panary.cloud erzeugt den Wert bei der Erstinstallation.'

  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new Error(`FEATHERS_SECRET ist nicht gesetzt — der Edge startet ohne JWT-Signaturschluessel nicht. ${hint}`)
  }

  const value = secret.trim()

  if (value === FEATHERS_SECRET_PLACEHOLDER) {
    throw new Error(
      `FEATHERS_SECRET entspricht dem Platzhalter "${FEATHERS_SECRET_PLACEHOLDER}" aus dem oeffentlichen Repo — ` +
        `damit signierte JWTs kann jeder faelschen. ${hint}`,
    )
  }

  if (value.length < FEATHERS_SECRET_MIN_LENGTH) {
    throw new Error(
      `FEATHERS_SECRET ist zu kurz (${value.length} Zeichen, mindestens ${FEATHERS_SECRET_MIN_LENGTH} noetig). ${hint}`,
    )
  }
}
