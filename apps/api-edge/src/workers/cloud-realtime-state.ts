// Geteilter Live-Status der Cloud-Socket-Verbindung.
//
// Der Realtime-Worker (cloud-realtime.worker.ts) setzt den Status über die
// Socket-Lifecycle-Callbacks (connect/disconnect/auth). Der BusinessDays-Pull-
// Worker liest ihn, um die Poll-Kadenz adaptiv zu wählen: Socket aktiv →
// langsamer Safety-Poll; Socket weg → schneller 5s-Fallback-Poll. So bleibt der
// Pull-Pfad jederzeit das Sicherheitsnetz, ohne im Normalbetrieb (Push aktiv)
// die Cloud unnötig zu pollen.

let socketConnected = false

export const setRealtimeConnected = (connected: boolean): void => {
  socketConnected = connected
}

export const isRealtimeConnected = (): boolean => socketConnected
