import {
  ApplicationConfig,
  importProvidersFrom,
  inject,
  provideBrowserGlobalErrorListeners,
  provideEnvironmentInitializer,
} from '@angular/core'
import { provideRouter, withRouterConfig } from '@angular/router'
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'
import { provideHttpClient } from '@angular/common/http'
import { TranslateModule } from '@ngx-translate/core'
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader'
import { appRoutes } from './app.routes'
import { APP_CONFIG } from '@panary/shared/data-access-config'
import { UiScaleService } from '@panary/shared/data-access-theme'
import { providePosRealtimeScopeGuard } from './realtime-scope-guard.provider'
import { providePosOfflineCache } from './offline-cache.provider'
import { providePosSnackBar } from './pos-snack-bar'
import { EDGE_URL } from './edge-url'
import packageJson from '../../../../package.json'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Die Kasse hält Browser-/Android-Zurück per `canDeactivate` an (core#828). Mit dem Standard
    // 'replace' überschriebe die abgebrochene Navigation den History-Eintrag davor; das nächste
    // Zurück landete dann auf /login statt auf der Übersicht. 'computed' springt zurück an die Stelle.
    provideRouter(appRoutes, withRouterConfig({ canceledNavigationResolution: 'computed' })),
    provideAnimationsAsync(),
    provideHttpClient(),
    importProvidersFrom(
      TranslateModule.forRoot({
        fallbackLang: 'de',
      }),
    ),
    provideTranslateHttpLoader({
      prefix: './assets/i18n/',
      suffix: '.json',
    }),
    providePosRealtimeScopeGuard(),
    providePosOfflineCache(),
    // Quittierpflichtige Meldungen (ohne duration, mit Aktion) kehren zurück, statt von
    // einer Kurzmeldung oder `dismiss()` verdrängt zu werden (core#531).
    providePosSnackBar(),
    // Fluide UI-Skalierung (PNRY-FEAT-POS-UI-SCALE-001): beim Boot
    // instanziieren, damit gespeicherte Dichte VOR dem ersten Paint auf
    // <html> angewendet wird — nur im POS-Client.
    provideEnvironmentInitializer(() => inject(UiScaleService)),
    {
      provide: APP_CONFIG,
      useValue: {
        apiUrl: EDGE_URL,
        websocketPath: '/ws',
        production: false,
        appVersion: packageJson.version,
        basicServerUrl: EDGE_URL,
        cloudUrl: 'https://api.panary.cloud',
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
