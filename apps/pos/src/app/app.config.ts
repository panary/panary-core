import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'
import { provideHttpClient } from '@angular/common/http'
import { appRoutes } from './app.routes'
import { APP_CONFIG } from '@panary-core/shared/data-access-config'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideAnimationsAsync(),
    provideHttpClient(),
    {
      provide: APP_CONFIG,
      useValue: {
        apiUrl: 'http://localhost:3030',
        websocketPath: '/ws',
        production: false,
        appVersion: '2026.3.1',
        basicServerUrl: 'http://localhost:3030',
        printOut: false,
        localStorageServerSettingsKey: 'panary_server_settings',
        localStorageLastLoggedInUserKey: 'panary_last_user',
        localStorageUsernamelistKey: 'panary_usernames',
        localStorageUsersKey: 'panary_users',
        localStorageCompanyNameKey: 'panary_company',
      },
    },
  ],
}
