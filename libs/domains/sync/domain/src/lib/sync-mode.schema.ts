import type { Static } from '@feathersjs/typebox'
import { Type } from '@feathersjs/typebox'

export const SyncMode = {
  AUTO: 'auto',
  SCHEDULED: 'scheduled',
  MANUAL: 'manual',
  DISABLED: 'disabled',
} as const

export type SyncMode = (typeof SyncMode)[keyof typeof SyncMode]

export const SYNC_INTERVAL_MIN_SEC = 60
export const SYNC_INTERVAL_MAX_SEC = 3600
export const SYNC_INTERVAL_DEFAULT_SEC = 300

export const syncScheduleSchema = Type.Object(
  {
    times: Type.Array(Type.String({ pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }), { minItems: 1, maxItems: 48 }),
    timezone: Type.String({ minLength: 1, maxLength: 64 }),
  },
  { $id: 'SyncSchedule', additionalProperties: false },
)

export type SyncSchedule = Static<typeof syncScheduleSchema>
