import { Static, StringEnum } from '@feathersjs/typebox'
import { defaultAppConfiguration, getValidator, Type } from '@feathersjs/typebox'

import { dataValidator } from './validators'

export const configurationSchema = Type.Intersect([
  defaultAppConfiguration,
  Type.Object({
    host: Type.String(),
    port: Type.Number(),
    public: Type.String(),
    system: Type.Object({
      mode: Type.String(),
      dbType: Type.String()
    }),
    logLevel: StringEnum(['error', 'warn', 'info', 'debug']),
  })
])

export type ApplicationConfiguration = Static<typeof configurationSchema>

export const configurationValidator = getValidator(configurationSchema, dataValidator)
