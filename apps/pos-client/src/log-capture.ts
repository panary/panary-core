import { Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { installGlobalLogCapture } from '@panary/shared/data-access-updater'

// Eigenes Modul, das `main.ts` als ERSTES importiert: ES-Importe werden vor dem Rumpf von `main.ts`
// ausgewertet. Stünde der Aufruf dort, liefe ein Fehler beim Laden von `app.config` & Co. noch am
// Mitschnitt vorbei (ADR 0069). Aktiv unter Tauri und im Android-Wrapper (Sunmi), sonst No-Op.
// Die Plugins kommen von hier, weil die Lib kein `@capacitor/*` importiert; unter Tauri und im
// Browser bleiben sie unbenutzt.
installGlobalLogCapture({ android: { filesystem: Filesystem, share: Share } })
