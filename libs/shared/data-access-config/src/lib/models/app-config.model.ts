export interface AppConfig {
  apiUrl: string
  websocketPath: string
  websocketUrl?: string
  production: boolean
  appVersion: string
  basicServerUrl: string
  printOut: boolean
  localStorageServerSettingsKey: string
  localStorageLastLoggedInUserKey: string
  localStorageUsernamelistKey: string
  localStorageUsersKey: string
  localStorageCompanyNameKey: string
}
