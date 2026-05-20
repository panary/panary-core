import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter, withComponentInputBinding } from '@angular/router'
import { provideHttpClient, withInterceptors } from '@angular/common/http'
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'
import { TranslateModule } from '@ngx-translate/core'
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader'
import { APP_CONFIG } from '@panary/shared/data-access-config'
import { appRoutes } from './app.routes'
import { authInterceptor } from './core/auth.interceptor'
import packageJson from '../../../../package.json'

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
    // analog `apps/pos-client/src/app/app.config.ts`; Production-Override
    // erfolgt zur Laufzeit ueber `/assets/config.json` (siehe `AppConfigService.loadConfig`).
    {
      provide: APP_CONFIG,
      useValue: {
        apiUrl: 'http://localhost:3030',
        websocketPath: '/ws',
        production: false,
        appVersion: packageJson.version,
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
