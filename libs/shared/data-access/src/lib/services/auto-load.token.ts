import { InjectionToken } from '@angular/core'

/**
 * App-weiter Schalter für den Eager-Load der Katalog-/Stammdaten-Services
 * (ProductService, UserService, OrderService, …): deren Konstruktor-Effect lädt
 * sonst beim ERSTEN Inject des Services den kompletten Datenbestand.
 *
 * Default `true` — der POS-Client braucht den Eager-Load (Offline-First).
 * Konsumenten ohne Eager-Bedarf (z. B. Admin-Apps) providen in der appConfig
 * `{ provide: DATA_ACCESS_AUTO_LOAD, useValue: false }` und laden stattdessen
 * gezielt über `ensureLoaded()` des jeweiligen Services.
 */
export const DATA_ACCESS_AUTO_LOAD = new InjectionToken<boolean>('DATA_ACCESS_AUTO_LOAD', {
  providedIn: 'root',
  factory: () => true,
})
