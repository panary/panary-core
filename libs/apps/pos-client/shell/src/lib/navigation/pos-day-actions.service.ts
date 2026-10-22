import { inject, Injectable } from '@angular/core'
import { MatDialog } from '@angular/material/dialog'
import { BusinessDayService, CashSessionService } from '@panary/businessdays/data-access'
import { BusinessDayOperationMode } from '@panary/businessdays/domain'
import {
  CashSessionDialogComponent,
  ClosingDialogComponent,
  OpeningDialogComponent,
  openManagerAuthorizeCashSessionDialog,
} from '@panary/businessdays/feature-pos-closing-dialog'
import { LocationService } from '@panary/locations/data-access'
import { PosWriteOffDialogComponent } from '@panary/write-offs/feature-pos-dialog'
import type { PosNavAction } from './pos-navigation'
import { PosStaffService } from './pos-staff.service'

/** Die Filiale, soweit die Dialoge sie lesen. Wird beim Edge-Sync mit der Cloud konsistent gehalten. */
interface ActiveLocation {
  _id?: string
  operationMode?: string
  currentBusinessDay?: { businessDayId?: string }
  settings?: { cashSessionSettings?: { defaultOpeningFloatCents?: number } }
}

/**
 * Die Dialog-Einträge des „Mehr"-Menüs: Abschreiben, Tag eröffnen, Tagesabschluss, Kassenlade.
 * Unverändert aus dem Dashboard übernommen (core#832), wo sie hinter den Kacheln lagen.
 */
@Injectable({ providedIn: 'root' })
export class PosDayActionsService {
  readonly #dialog = inject(MatDialog)
  readonly #locations = inject(LocationService)
  readonly #businessDays = inject(BusinessDayService)
  readonly #cashSessions = inject(CashSessionService)
  readonly #staff = inject(PosStaffService)

  run(action: PosNavAction): void {
    switch (action) {
      case 'write-off':
        return this.openWriteOff()
      case 'open-business-day':
        return this.startOpening()
      case 'close-business-day':
        return this.startClosing()
      case 'cash-drawer':
        return this.manageCashSession()
    }
  }

  openWriteOff(): void {
    this.#dialog.open(PosWriteOffDialogComponent, {
      width: '98vw',
      maxWidth: '98vw',
      height: '95vh',
      maxHeight: '95vh',
      panelClass: 'fullscreen-dialog',
    })
  }

  /** Der Edge-Service patcht danach `Location.currentBusinessDay`; das Menü folgt reaktiv. */
  startOpening(): void {
    const location = this.#activeLocation()
    const operationMode =
      location?.operationMode === 'orders-only'
        ? BusinessDayOperationMode.ORDERS_ONLY
        : BusinessDayOperationMode.POS_CASHIER

    this.#dialog.open(OpeningDialogComponent, {
      width: '30rem',
      maxWidth: '92vw',
      maxHeight: '90vh',
      disableClose: false,
      data: { locationId: location?._id ?? null, operationMode },
    })
  }

  /** Der Dialog ruft `closeDay()`, das Outbox-Vorabprüfung und Cloud-Trigger erledigt. */
  startClosing(): void {
    const businessDayId = this.#activeLocation()?.currentBusinessDay?.businessDayId
    if (!businessDayId) {
      console.warn('startClosing: kein offener Geschäftstag — Aktion ignoriert')
      return
    }

    void (async () => {
      try {
        // Volle BusinessDay-Daten (operationMode etc.) statt des Snapshots an der Filiale.
        const businessDay = await this.#businessDays.get(businessDayId)
        this.#dialog.open(ClosingDialogComponent, {
          width: '31.25rem',
          maxWidth: '90vw',
          height: 'auto',
          maxHeight: '90vh',
          disableClose: true,
          panelClass: 'closing-dialog-panel',
          data: { businessDay },
        })
      } catch (err) {
        console.error('startClosing: BusinessDay konnte nicht geladen werden', err)
      }
    })()
  }

  /**
   * Eigene Lade offen → Zählen/Schließen. Sonst Eröffnung mit Manager-PIN: Die Direkt-Eröffnung
   * durch STAFF sperrt das Backend.
   */
  manageCashSession(): void {
    const location = this.#activeLocation()
    const businessDayId = location?.currentBusinessDay?.businessDayId
    if (!businessDayId) {
      console.warn('manageCashSession: kein offener Geschäftstag — Aktion ignoriert')
      return
    }
    // Der Kassierer, nicht der Geräte-User: sonst griffe der cash-session-Guard beim Kassieren weiter.
    const user = this.#staff.currentUser()
    const userId = user?._id
    if (!userId) {
      console.warn('manageCashSession: kein angemeldeter Benutzer — Aktion ignoriert')
      return
    }

    void (async () => {
      let session = null
      try {
        session = await this.#cashSessions.findOpenForUser(businessDayId, userId)
      } catch (err) {
        console.error('manageCashSession: offene Kasse konnte nicht geladen werden', err)
      }

      if (session) {
        this.#dialog.open(CashSessionDialogComponent, {
          width: '32.5rem',
          maxWidth: '92vw',
          maxHeight: '90vh',
          disableClose: false,
          data: { businessDayId, session },
        })
        return
      }

      // Den Erfolg quittiert der Dialog selbst; an der Navigation hängt kein Zustand der Kasse.
      const cashierName = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || undefined
      openManagerAuthorizeCashSessionDialog(this.#dialog, {
        businessDayId,
        cashierId: String(userId),
        cashierName,
        defaultOpeningFloatCents: location?.settings?.cashSessionSettings?.defaultOpeningFloatCents,
      })
    })()
  }

  #activeLocation(): ActiveLocation | undefined {
    return this.#locations.activeLocation() as ActiveLocation | undefined
  }
}
