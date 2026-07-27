import { bootstrapApplication } from '@angular/platform-browser'
import { appConfig } from './app/app.config'
import { AppComponent } from './app/app'

/* DPI-Verifikation für PNRY-FEAT-POS-UI-SCALE-001: devicePixelRatio spiegelt im
   WebView2 das OS-Display-Scaling (100 % → 1, 125 % → 1.25, …), die Viewport-Maße
   zeigen, mit welcher CSS-Breite die vw-basierte Root-Fontsize-Formel rechnet.
   Wird auf dem echten Windows-Terminal bei 100/125/150 % gegengeprüft. */
console.info('[pos-boot] display-metrics', {
  devicePixelRatio: window.devicePixelRatio,
  innerWidth: window.innerWidth,
  innerHeight: window.innerHeight,
  screenWidth: screen.width,
  screenHeight: screen.height,
})

bootstrapApplication(AppComponent, appConfig).catch(err => console.error(err))
