import './bootstrap'
import { logger } from './logger'
import fs from 'fs/promises'
import path from 'path'
import { startSetupApp } from './setup-app'
import { constants } from 'fs'
import { UserSystemRole } from '@panary-core/users/domain'

const CONFIG_PATH =
  process.env['PANARY_CONFIG_PATH'] || path.join(process.cwd(), 'data', 'panary.config.json')

async function main() {
  try {
    // Check if config file exists
    await fs.access(CONFIG_PATH, constants.F_OK)

    logger.info(`Configuration found at ${CONFIG_PATH}. Starting in PRODUCTION MODE.`)

    // Load configuration
    let config: any = {}
    try {
      const configRaw = await fs.readFile(CONFIG_PATH, 'utf-8')
      config = JSON.parse(configRaw)

      // Set environment variables from config
      for (const [key, value] of Object.entries(config)) {
        // We only set primitive values as env vars. Objects/Arrays are likely specific config sections handled by Feathers config
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          process.env[key] = String(value)
        }
      }

      // Inject the config object into NODE_CONFIG for Feathers/Node-Config to pick up deeply nested values override
      // process.env['NODE_CONFIG'] = JSON.stringify(config)
      // User requested "set environment variables", assuming simpler flat env vars for now or standard feathers behavior.
    } catch (e) {
      logger.error('Error reading configuration file', e)
      throw e
    }

    // Dynamic import of app to prevent early initialization
    // Node dynamic import requires extension in CJS environment if treating as ESM-like
    const { app } = await import('./app.js')

    const port = app.get('port') || 3030
    const host = app.get('host') || 'localhost'

    process.on('unhandledRejection', (reason, p) =>
      logger.error('Unhandled Rejection at: Promise ', p, reason)
    )

    // app.listen() calls app.setup() internally, which runs setup hooks (migrations)
    await app.listen(port)
    logger.info(`Feathers app listening on http://${host}:${port}`)

    // --- Bootstrapping: Create Admin User if credentials exist in config ---
    // Must run AFTER app.listen() so that setup hooks (migrations) have completed
    const adminEmail = process.env['ADMIN_EMAIL'] || config.adminEmail
    const adminPassword = process.env['ADMIN_PASSWORD'] || config.adminPassword

    if (adminEmail && adminPassword) {
      logger.info('Bootstrapping: Found admin credentials in config. Verifying admin user...')
      try {
        const knex = app.get('sqliteClient')
        const adminLogin = config.shopName || 'Admin'

        // Query DB directly to bypass service hooks (no JWT/auth needed for bootstrap)
        const existingUser = await knex('users').where({ loginname: adminLogin }).first()

        if (!existingUser) {
          logger.info(`Bootstrapping: Creating admin user ${adminLogin}...`)

          // Use the service for create so password hashing hooks run
          const usersService = app.service('users')
          const createdUser = await usersService.create({
            email: adminEmail,
            password: adminPassword,
            role: UserSystemRole.PLATFORM_ADMIN,
            loginname: adminLogin,
            firstName: 'Admin',
            lastName: 'User',
            tenantId: null,
            activeLocationId: null,
            allowedLocationIds: [],
            permissions: []
          }, { provider: undefined })

          if (createdUser && createdUser._id) {
            logger.info(`Bootstrapping: Admin user created successfully (ID: ${createdUser._id}).`)
          } else {
            logger.error('Bootstrapping: Admin user create call returned no result — check service hooks!')
          }
        } else {
          logger.info('Bootstrapping: Admin user already exists.')
        }

        // --- Security: Remove password from config file ---
        if (config.adminPassword) {
          logger.info('Security: Removing plain-text password from configuration file...')
          delete config.adminPassword

          await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
          logger.info('Security: Configuration file sanitized.')
        }
      } catch (err) {
        logger.error('Bootstrapping: Failed to create admin user.', err)
      }
    }
    // -----------------------------------------------------------------------
  } catch (error) {
    // Config file not found or error loading it -> Setup Mode
    logger.error(
      `Configuration check failed or file missing at ${CONFIG_PATH}. Starting in SETUP MODE.`,
      error
    )
    // Port 3030 for setup as well? Yes.
    await startSetupApp(3030)
  }
}

main().catch(err => {
  logger.error('Fatal error during startup', err)
  process.exit(1)
})
