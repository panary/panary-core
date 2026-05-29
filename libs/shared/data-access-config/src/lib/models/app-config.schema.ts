import { Static, Type } from '@feathersjs/typebox'

export const appConfigSchema = /* @__PURE__ */ Type.Object(
  {
    apiUrl: Type.String(),
    websocketPath: Type.String(),
    websocketUrl: Type.Optional(Type.String()),
    production: Type.Boolean(),
    appVersion: Type.String(),
    basicServerUrl: Type.String(),
    // Fest hinterlegte Panary-Cloud-URL: Default-Pfad im POS-Setup-Wizard
    // („Mit Panary Cloud verbinden"). Optional, damit nicht jede App sie setzen muss.
    cloudUrl: Type.Optional(Type.String()),
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
