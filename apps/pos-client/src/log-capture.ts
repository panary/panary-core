import { installGlobalLogCapture } from '@panary/shared/data-access-updater'

// Eigenes Modul, das `main.ts` als ERSTES importiert: ES-Importe werden vor dem Rumpf von `main.ts`
// ausgewertet. Stünde der Aufruf dort, liefe ein Fehler beim Laden von `app.config` & Co. noch am
// Mitschnitt vorbei (ADR 0069). No-Op außerhalb Tauri.
installGlobalLogCapture()
