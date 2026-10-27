import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter, withRouterConfig } from '@angular/router'
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'
import { provideHttpClient, withXhr } from '@angular/common/http'
import { appRoutes } from './app.routes'

// TODO: Migrate these shared libs or fix imports
// import { APP_CONFIG } from '@panary/shared/data-access-config'
// import { environment } from '../environments/environment'
const APP_CONFIG = 'APP_CONFIG' // Mock for now
const environment = { production: false } // Mock for now

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    // Angular 22 erbt Routen-Parameter per Default an alle Kinder ('always'). 'emptyOnly' hält das
    // Verhalten bis v21 fest (panary/panary-core#129); umstellen erst mit Prüfung der Kind-Routen.
    provideRouter(appRoutes, withRouterConfig({ paramsInheritanceStrategy: 'emptyOnly' })),
    provideAnimationsAsync(),
    provideHttpClient(withXhr()),
    {
      provide: APP_CONFIG,
      useValue: environment,
    },
  ],
}
