import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter, withComponentInputBinding } from '@angular/router'
import { provideHttpClient, withInterceptors } from '@angular/common/http'
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'
import { TranslateModule } from '@ngx-translate/core'
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader'
import { APP_CONFIG } from '@panary/shared/data-access-config'
import { CLOUD_STATUS_BANNER_OPTIONS } from '@panary/shared/data-access'
import { appRoutes } from './app.routes'
import { API_BASE_URL } from './core/api-base-url'
import { authInterceptor } from './core/auth.interceptor'
import packageJson from '../../../../package.json'

const apiUrl = API_BASE_URL

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    importProvidersFrom(TranslateModule.forRoot({ fallbackLang: 'de' })),
    provideTranslateHttpLoader({ prefix: './assets/i18n/', suffix: '.json' }),
    // APP_CONFIG-Provider — Pflicht, weil `AppConfigService` (von
    // `ConnectionService` injiziert) `inject(APP_CONFIG)` aufruft.
    // Ohne diesen Provider: NG0201 beim App-Bootstrap, weisse Seite. Werte
    // analog `apps/pos-client/src/app/app.config.ts`; `apiUrl` wird zur Laufzeit
    // aus dem Origin abgeleitet (siehe `core/api-base-url.ts`).
    {
      provide: APP_CONFIG,
      useValue: {
        apiUrl,
        websocketPath: '/ws',
        production: false,
        appVersion: packageJson.version,
        basicServerUrl: apiUrl,
        printOut: false,
        localStorageServerSettingsKey: 'panary_server_settings',
        localStorageLastLoggedInUserKey: 'panary_last_user',
        localStorageUsernamelistKey: 'panary_usernames',
        localStorageUsersKey: 'panary_users',
        localStorageCompanyNameKey: 'panary_company',
      },
    },
    // Notfall-Modus-Banner nur im Admin: er beschreibt einen reinen
    // Administrations-Zustand und traegt eine Aktion, die
    // `CLOUD_CONNECTION: MANAGE` verlangt. Auf der Kasse waere er dauerhaftes
    // Rauschen ohne Handlungsmoeglichkeit (der POS belegt den Token nicht).
    {
      provide: CLOUD_STATUS_BANNER_OPTIONS,
      useValue: { showEmergencyOverride: true },
    },
  ],
}
