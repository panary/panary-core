import { Static, StringEnum } from '@feathersjs/typebox'
import { defaultAppConfiguration, getValidator, Type } from '@feathersjs/typebox'

import { dataValidator } from '@panary-core/shared-backend'

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
  })
])

export type ApplicationConfiguration = Static<typeof configurationSchema>

export const configurationValidator = getValidator(configurationSchema, dataValidator)
