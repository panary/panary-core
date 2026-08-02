import { computed, inject, Injectable, Signal } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { ConnectionService } from '@panary/shared/data-access'
import { AuthService } from './auth.service'

/** Warum die Mitarbeiter-Sitzung beendet wurde — nur fuer Diagnose/Logging. */
export type PosLogoutReason = 'button' | 'idle' | 'clock-out'

/**
 * Beendet die MITARBEITER-Sitzung am POS-Terminal.
 *
 * Einziger Logout-Pfad des POS: der Abmelden-Button, das Ausstempeln und der
 * Inaktivitaets-Logout laufen alle hier durch. Vorher lag die Logik als Methode
 * in `DashboardComponent` — ein zweiter Aufrufer haette sie kopieren muessen,
 * inklusive der Offline-Sperre, deren Vergessen das Geraet aussperrt.
 *
 * Liegt in `auth/data-access`, weil sowohl die POS-Shell als auch die
 * Feature-Libs (Dashboard) von hier bereits `AuthService` beziehen — die
 * umgekehrte Richtung waere eine Abhaengigkeits-Inversion.
 */
@Injectable({ providedIn: 'root' })
export class PosSessionService {
  #auth = inject(AuthService)
  #connection = inject(ConnectionService)
  #dialog = inject(MatDialog)

  /**
   * Offline darf sich der Mitarbeiter nicht abmelden: die Wiederanmeldung laeuft
   * ueber die serverseitige PIN-Pruefung (`users.verifyPin`) und
   * `AuthService.logout()` loescht das Geraete-JWT (`sessionStorage.clear()`).
   * Ein Abmelden ohne Verbindung wuerde das Terminal bis zum Reconnect komplett
   * aussperren — mit offenen Bestellungen in der Outbox.
   */
  readonly isOffline: Signal<boolean> = computed(() => {
    const status = this.#connection.connectionState().status
    return status !== 'connected' && status !== 'authenticated'
  })

  /** Laeuft gerade ein Logout? Verhindert doppelte Navigation und Snackbars. */
  #inFlight = false

  /**
   * Beendet die Sitzung. Liefert `false`, wenn nichts passiert ist (offline
   * oder bereits laufender Logout) — der Aufrufer entscheidet, ob er das dem
   * Nutzer meldet.
   */
  async endSession(reason: PosLogoutReason): Promise<boolean> {
    if (this.isOffline()) return false

    // Der periodische JWT-Ablauf-Check im AuthService kann in derselben Sekunde
    // feuern wie ein Button-Klick oder der Idle-Timer. Ohne Guard gaebe das zwei
    // `router.navigate` und zwei Snackbars uebereinander.
    if (this.#inFlight) return false
    this.#inFlight = true

    try {
      // Offene Dialoge (Beleg-Druck, Tagesabschluss, Abschreibung) wuerden sonst
      // ueber dem Login-Screen stehen bleiben — eine Navigation schliesst
      // CDK-Overlays nicht. `closeAll()` umgeht `disableClose`, das nur fuer
      // Backdrop und ESC gilt; genau das ist hier erwuenscht.
      this.#dialog.closeAll()
      console.info('[PosSessionService] Mitarbeiter-Sitzung beendet. Grund:', reason)
      return await this.#auth.logout()
    } finally {
      this.#inFlight = false
    }
  }
}
