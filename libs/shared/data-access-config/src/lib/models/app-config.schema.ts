import { Static, Type } from '@feathersjs/typebox'

export const appConfigSchema = Type.Object(
  {
    apiUrl: Type.String(),
    websocketPath: Type.String(),
    websocketUrl: Type.Optional(Type.String()),
    production: Type.Boolean(),
    appVersion: Type.String(),
    basicServerUrl: Type.String(),
    printOut: Type.Boolean(),
    localStorageServerSettingsKey: Type.String(),
    localStorageLastLoggedInUserKey: Type.String(),
    localStorageUsernamelistKey: Type.String(),
    localStorageUsersKey: Type.String(),
    localStorageCompanyNameKey: Type.String(),
  },
  { $id: 'AppConfig', additionalProperties: false },
)
export type AppConfig = Static<typeof appConfigSchema>
