import { ApplicationConfig, importProvidersFrom, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter, withRouterConfig } from '@angular/router'
import { appRoutes } from './app.routes'
import { provideHttpClient, withFetch, withInterceptorsFromDi } from '@angular/common/http'
import { TranslateModule } from '@ngx-translate/core'
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader'

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Angular 22 erbt Routen-Parameter per Default an alle Kinder ('always'). 'emptyOnly' hält das
    // Verhalten bis v21 fest (panary/panary-core#129); umstellen erst mit Prüfung der Kind-Routen.
    provideRouter(appRoutes, withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly' })),
    provideHttpClient(withFetch(), withInterceptorsFromDi()),
    importProvidersFrom(
      TranslateModule.forRoot({
        fallbackLang: 'en',
      }),
    ),
    provideTranslateHttpLoader({
      prefix: './assets/i18n/',
      suffix: '.json',
    }),
  ],
}
