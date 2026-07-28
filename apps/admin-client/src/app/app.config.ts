import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter, withComponentInputBinding } from '@angular/router'
import { provideHttpClient, withInterceptors } from '@angular/common/http'
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'
import { TranslateModule } from '@ngx-translate/core'
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader'
import { APP_CONFIG } from '@panary/shared/data-access-config'
import { CLOUD_STATUS_BANNER_OPTIONS } from '@panary/shared/data-access'
import { appRoutes } from './app.routes'
import { authInterceptor } from './core/auth.interceptor'
import packageJson from '../../../../package.json'

// Fallback fuer den Angular-Dev-Server (Port 4202): dort laeuft das Panel unter
// `baseHref: '/'` und das Edge-Backend liegt auf einem anderen Port.
const DEV_SERVER_API_URL = 'http://localhost:3030'

/**
 * Basis-URL des Edge-Backends.
 *
 * Im Production-Build liefert das Edge-Backend das Panel selbst unter `/admin/`
 * aus (`baseHref`, siehe `apps/api-edge/src/app.ts`) — Panel und API teilen sich
 * also immer denselben Origin, egal ob `localhost`, LAN-IP oder Hostname.
 *
 * Ohne diese Ableitung stand hier fix `http://localhost:3030`: beim Aufruf ueber
 * die LAN-IP (z.B. `http://10.10.100.3:3030/admin`) zeigte der WebSocket damit auf
 * den *Client*-Rechner statt auf den Server → Dauerfehler "Keine Verbindung zum
 * Server". Der `/assets/config.json`-Laufzeit-Override (`AppConfigService`) greift
 * hier nicht: er wird beim Bootstrap nie aufgerufen und laege wegen des `baseHref`
 * ohnehin unter einem anderen Pfad.
 */
function resolveApiUrl(): string {
  // `baseURI` spiegelt das gebaute `<base href>` — `/admin/` nur im Production-Build,
  // die Routen selbst tragen kein `/admin`-Praefix.
  return document.baseURI.includes('/admin/') ? window.location.origin : DEV_SERVER_API_URL
}

const apiUrl = resolveApiUrl()

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
    // aus dem Origin abgeleitet (siehe `resolveApiUrl`).
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
