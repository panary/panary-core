import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async'
import { provideHttpClient } from '@angular/common/http'
import { appRoutes } from './app.routes'

// TODO: Migrate these shared libs or fix imports
// import { APP_CONFIG } from '@panary/shared/data-access-config'
// import { environment } from '../environments/environment'
const APP_CONFIG = 'APP_CONFIG' // Mock for now
const environment = { production: false } // Mock for now

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(appRoutes),
    provideAnimationsAsync(),
    provideHttpClient(),
    {
      provide: APP_CONFIG,
      useValue: environment,
    },
  ],
}
