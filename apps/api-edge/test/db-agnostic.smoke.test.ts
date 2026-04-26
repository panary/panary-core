// DB-Agnostik-Smoke-Test (M2-Gatekeeper für M3)
//
// Statische Prüfung aller Service-Setups in `apps/api-edge/src/services/`:
// Kein Service darf `knex` direkt importieren oder `app.get('sqliteClient')`
// ohne vorhergehende dbType-Verzweigung verwenden. Die SQLite/MongoDB-Entscheidung
// erfolgt ausschließlich über `DatabaseType` + `createServiceAdapter`.
//
// Dieser Test ist der Freigabe-Check für die Schema- und Backend-Package-Extraktion (M3):
// Schlägt er fehl, gibt es irgendwo noch einen hart an SQLite gebundenen Service.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

const SERVICES_DIR = join(__dirname, '..', 'src', 'services')

// Services ohne Adapter-Fabrik (reine Custom-Services, nicht persistenzgebunden).
const SERVICES_WITHOUT_ADAPTER = new Set<string>([
  'organizations',
  'cloud-connection',
  'opening-hour-exceptions',
])

const readServiceSetup = (serviceName: string): string => {
  const file = join(SERVICES_DIR, serviceName, `${serviceName}.ts`)
  return readFileSync(file, 'utf-8')
}

const listServices = (): string[] =>
  readdirSync(SERVICES_DIR).filter((entry) => {
    const fullPath = join(SERVICES_DIR, entry)
    return statSync(fullPath).isDirectory()
  })

describe('db-agnostic smoke (M2 → M3 gatekeeper)', () => {
  const services = listServices()

  it('findet alle erwarteten Service-Verzeichnisse', () => {
    expect(services.length).toBeGreaterThanOrEqual(12)
  })

  it.each(services)(
    'Service "%s" importiert knex nicht direkt',
    (serviceName) => {
      const source = readServiceSetup(serviceName)

      expect(source, `${serviceName}.ts`).not.toMatch(/from\s+['"]knex['"]/)
      expect(source, `${serviceName}.ts`).not.toMatch(/require\(\s*['"]knex['"]\s*\)/)
    },
  )

  it.each(services.filter((s) => !SERVICES_WITHOUT_ADAPTER.has(s)))(
    'Service "%s" nutzt createServiceAdapter + DatabaseType',
    (serviceName) => {
      const source = readServiceSetup(serviceName)

      expect(source, `${serviceName}.ts nutzt createServiceAdapter`).toMatch(/createServiceAdapter/)
      expect(source, `${serviceName}.ts liest app.get('system')`).toMatch(
        /app\.get\(\s*['"]system['"]\s*\)/,
      )
      expect(source, `${serviceName}.ts verzweigt über DatabaseType`).toMatch(/DatabaseType\./)
    },
  )

  it.each(services.filter((s) => !SERVICES_WITHOUT_ADAPTER.has(s)))(
    'Service "%s" greift sqliteClient nur hinter dbType-Check zu',
    (serviceName) => {
      const source = readServiceSetup(serviceName)
      if (!/sqliteClient/.test(source)) return

      const dbTypeBranchRegex = /dbType\s*===\s*DatabaseType\.SQLITE[\s\S]*?sqliteClient/
      expect(source, `${serviceName}.ts: sqliteClient-Zugriff ohne vorhergehende SQLite-Verzweigung`).toMatch(
        dbTypeBranchRegex,
      )
    },
  )
})
