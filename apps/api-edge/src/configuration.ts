import { Static, StringEnum } from '@feathersjs/typebox'
import { defaultAppConfiguration, getValidator, Type } from '@feathersjs/typebox'

import { dataValidator } from '@panary/shared-backend'

export const configurationSchema = Type.Intersect([
  defaultAppConfiguration,
  Type.Object({
    host: Type.String(),
    port: Type.Number(),
    system: Type.Object({
      mode: Type.String(),
      dbType: Type.String()
    }),
    logLevel: StringEnum(['error', 'warn', 'info', 'debug']),
    // Phase 2 — Audit-Cleanup-Worker (Edge). Optional, mit Defaults im Worker.
    auditCleanup: Type.Optional(
      Type.Object({
        enabled: Type.Boolean(),
        retentionDays: Type.Number({ minimum: 1, maximum: 3650 }),
        hour: Type.Number({ minimum: 0, maximum: 23 }),
        minuteJitterMs: Type.Number({ minimum: 0 }),
        cloudReachableMaxAgeDays: Type.Number({ minimum: 1 }),
        batchSize: Type.Number({ minimum: 1, maximum: 10000 }),
      })
    ),
    // Standalone-Geschaeftstag-Rotations-Worker. Optional, mit Defaults im Worker.
    businessDayRotation: Type.Optional(
      Type.Object({
        enabled: Type.Boolean(),
        hour: Type.Number({ minimum: 0, maximum: 23 }),
        minuteJitterMs: Type.Number({ minimum: 0 }),
      })
    ),
    // Zeit-Guard: verweigert neue Bestellungen, wenn der offene Geschaeftstag
    // seit Oeffnung laenger als diese Stundenzahl offen ist (Default 24h im Hook).
    maxBusinessDayOpenHours: Type.Optional(Type.Number({ minimum: 1 })),
    // TSE-Fiskalisierung (KassenSichV). Optional — ohne Konfiguration ist TSE in
    // Nicht-Produktion der Simulator, in Produktion inaktiv (siehe resolveTseProvider).
    tse: Type.Optional(
      Type.Object({
        provider: StringEnum(['simulator', 'fiskaly']),
        baseUrl: Type.Optional(Type.String()),
      })
    ),
  })
])

export type ApplicationConfiguration = Static<typeof configurationSchema>

export const configurationValidator = getValidator(configurationSchema, dataValidator)
