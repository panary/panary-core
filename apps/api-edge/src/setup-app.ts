import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { koa, bodyParser, serveStatic } from '@feathersjs/koa'
import { logger } from '@panary/shared-backend'
import { generateSetupToken, SETUP_REJECTION_STATUS, SETUP_TOKEN_TTL_MS, SetupTokenGuard } from './utils/setup-token'

// Path to configuration file
// Default to ./data/panary.config.json relative to CWD, or use env var
const CONFIG_PATH = process.env['PANARY_CONFIG_PATH'] || path.join(process.cwd(), 'data', 'panary.config.json')

/**
 * Das Setup-Token liegt neben der Konfiguration im Datenverzeichnis. Zusammen
 * mit dem Container-Log ist das der einzige Weg, es zu erfahren — beide setzen
 * Zugriff auf den Host voraus, und genau das ist der Besitznachweis.
 */
const SETUP_TOKEN_PATH = path.join(path.dirname(CONFIG_PATH), 'setup-token.txt')

/** Header, ueber den der Setup-Client das Token mitschickt. */
const SETUP_TOKEN_HEADER = 'x-setup-token'

/**
 * Get the local IP address of the device (non-internal IPv4)
 */
function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // Skip internal (127.0.0.1) and non-IPv4 addresses
      if ('IPv4' !== iface.family || iface.internal) {
        continue
      }
      return iface.address
    }
  }
  return '127.0.0.1' // Fallback
}

/**
 * Schreibt das Token dorthin, wo nur der Betreiber es findet: ins
 * Container-Log und in eine Datei mit Modus 0600 im Datenverzeichnis.
 *
 * Der Schreibfehler ist bewusst nicht toedlich — laeuft das Datenverzeichnis
 * nur lesbar, bleibt das Log als Weg. Ein Setup-Modus, der wegen einer
 * Dateirechte-Frage gar nicht erst startet, waere schlimmer als einer mit nur
 * einem Ausgabekanal.
 */
async function announceSetupToken(token: string, expiresAtIso: string): Promise<void> {
  const banner = [
    '',
    '='.repeat(64),
    '  PANARY EDGE — SETUP-MODUS',
    '',
    `  Setup-Token:  ${token}`,
    `  Gueltig bis:  ${expiresAtIso} (${Math.round(SETUP_TOKEN_TTL_MS / 60000)} Minuten)`,
    '',
    '  Das Token wird im Einrichtungs-Assistenten abgefragt. Ein abgelaufenes',
    '  Token wird durch einen Neustart des Containers erneuert.',
    '='.repeat(64),
    '',
  ].join('\n')

  // Absichtlich ueber die Banner-Zeilen und nicht als strukturiertes Feld: Das
  // hier liest ein Mensch im `docker logs`, kein Log-Aggregator.
  logger.info(banner)

  try {
    await fs.mkdir(path.dirname(SETUP_TOKEN_PATH), { recursive: true })
    await fs.writeFile(SETUP_TOKEN_PATH, `${token}\n`, { encoding: 'utf-8', mode: 0o600 })
    // `writeFile` setzt den Modus nur beim Anlegen — eine Datei aus einem
    // frueheren Lauf behielte ihre alten Rechte.
    await fs.chmod(SETUP_TOKEN_PATH, 0o600)
    logger.info(`Setup-Token auch abgelegt unter ${SETUP_TOKEN_PATH}`)
  } catch (err) {
    logger.warn({
      message: `Setup-Token konnte nicht nach ${SETUP_TOKEN_PATH} geschrieben werden — es steht nur im Log.`,
      event: 'setup.token_file_failed',
      error: err,
    })
  }
}

export async function startSetupApp(port: number) {
  const app = koa()

  // Das Token bleibt hier lokal: Der Guard gibt es nicht wieder heraus, damit
  // es aus Versehen nie in einer HTTP-Antwort landen kann.
  const setupToken = generateSetupToken()
  const guard = new SetupTokenGuard(setupToken)

  app.use(bodyParser())

  // API Routes
  app.use(async (ctx, next) => {
    if (ctx.path === '/api/system-info' && ctx.method === 'GET') {
      const ip = getLocalIpAddress()
      ctx.body = {
        status: 'unconfigured',
        ip: ip,
        url: `http://${ip}:${port}`,
      }
      return
    }

    if (ctx.path === '/api/setup' && ctx.method === 'POST') {
      try {
        // Besitznachweis zuerst (#323) — vor jeder Auswertung des Bodys. Das
        // Token kommt als Header und NICHT im Body: Der Body wird unten 1:1
        // nach panary.config.json geschrieben, das Token laege damit dauerhaft
        // im Klartext auf der Platte.
        const verdict = guard.verify(ctx.ip || 'unknown', ctx.get(SETUP_TOKEN_HEADER))
        if (!verdict.ok) {
          const reason = verdict.reason ?? 'invalid_token'
          ctx.status = SETUP_REJECTION_STATUS[reason]
          ctx.body = { error: reason }
          logger.warn({
            message: `Setup abgelehnt: ${reason}`,
            event: 'setup.rejected',
            reason,
            ip: ctx.ip,
          })
          return
        }

        const config = ctx.request.body

        // Basic validation
        if (!config || typeof config !== 'object') {
          ctx.status = 400
          ctx.body = { error: 'Invalid configuration data' }
          return
        }

        // Ensure directory exists
        const configDir = path.dirname(CONFIG_PATH)
        await fs.mkdir(configDir, { recursive: true })

        // Write configuration
        await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')

        logger.info(`Configuration written to ${CONFIG_PATH}`)

        // Erst jetzt entwerten: Ein Token, das an einem Schreibfehler
        // verbraucht wuerde, zwaenge zu einem Container-Neustart, obwohl nichts
        // passiert ist.
        guard.markUsed()
        // Die Token-Datei hat ihren Zweck erfuellt. Best-effort — bleibt sie
        // liegen, ist sie durch markUsed() ohnehin wertlos, und der naechste
        // Setup-Modus ueberschreibt sie.
        await fs.rm(SETUP_TOKEN_PATH, { force: true }).catch(() => undefined)

        ctx.body = { status: 'OK' }

        // Graceful exit to restart in production mode
        setTimeout(() => {
          logger.info('Restarting server in 2 seconds...')
          process.exit(0)
        }, 2000)
      } catch (error: any) {
        logger.error('Failed to save configuration', error)
        ctx.status = 500
        ctx.body = { error: 'Failed to save configuration', details: error.message }
      }
      return
    }

    await next()
  })

  // Static Frontend (Setup Client)
  // Assuming the setup-client is built to dist/apps/setup-client relative to workspace root
  // If running from dist/apps/api-edge, we need to go up
  // ADJUST THIS PATH BASED ON ACTUAL BUILD ARTIFACTS
  // Debug middleware for static files
  app.use(async (ctx, next) => {
    logger.info(`Request: ${ctx.method} ${ctx.path}`)
    await next()
    if (ctx.status === 404) {
      // Check if it's an API call or asset
      if (ctx.path.startsWith('/api') || ctx.path.includes('.')) {
        logger.warn(`404 Not Found: ${ctx.path}`)
        return
      }

      // SPA Fallback: Serve index.html
      logger.info(`SPA Fallback for: ${ctx.path}`)
      const indexFile = path.isAbsolute(setupClientPath)
        ? path.join(setupClientPath, 'index.html')
        : path.join(__dirname, setupClientPath, 'index.html')

      try {
        ctx.type = 'html'
        ctx.body = await fs.readFile(indexFile, 'utf-8')
      } catch (err) {
        logger.error(`Failed to serve index.html fallback: ${err}`)
      }
    }
  })

  // Static Frontend (Setup Client)
  // Assuming the setup-client is built to dist/apps/setup-client relative to workspace root
  // If running from dist/apps/api-edge, we need to go up
  // ADJUST THIS PATH BASED ON ACTUAL BUILD ARTIFACTS
  const setupClientPath = process.env['SETUP_CLIENT_PATH'] || path.join(process.cwd(), 'dist/apps/setup-client/browser')

  if (path.isAbsolute(setupClientPath)) {
    app.use(serveStatic(setupClientPath))
  } else {
    app.use(serveStatic(path.join(__dirname, setupClientPath)))
  }

  app.listen(port, () => {
    logger.info(`Started in SETUP MODE on http://${getLocalIpAddress()}:${port}`)
    logger.info(`Serving setup client from ${setupClientPath}`)
    void announceSetupToken(setupToken, guard.expiresAtIso)
    // Auch im Setup-Modus werben, damit der POS-Wizard einen noch nicht
    // eingerichteten Hub findet und den Hinweis "zuerst einrichten" zeigen kann
    // (`setup.component.ts` schaltet bei `setupComplete === false` auf
    // 'hub-setup-hint'). Ohne die Annonce taucht ein frischer Hub in der
    // Geraeteliste gar nicht auf, und der Nutzer saehe nicht, warum.
    //
    // Geprueft und bewusst beibehalten (#323): Die Annonce macht den Hub
    // auffindbar, seit dem Token aber nicht mehr uebernehmbar. Was entfaellt,
    // ist `version` — sie nennt einem Scanner die Angriffsflaeche und hilft dem
    // Wizard in diesem Zustand nichts: Er zeigt ohnehin nur "zuerst einrichten"
    // und liest den echten Stand danach aus /health.
    void import('./mdns-advertiser.js').then(({ startMdnsAdvertising }) =>
      startMdnsAdvertising({
        port,
        setupComplete: false,
        systemMode: 'setup',
      }),
    )
  })
}
