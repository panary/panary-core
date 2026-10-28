import { inject, Injectable, signal } from '@angular/core'
import { Observer } from 'rxjs'
import { BaseService, ConnectionService } from '@panary/shared/data-access'
import { BusinessDay } from '@panary/businessdays/domain'

/** Antwort von `businessdays.getClosedDayStatus` (Edge, panary/panary-core#1133). */
export interface ClosedDayStatus {
  approvalRequired: boolean
  state: 'closed' | 'open' | 'unknown'
  date: string
  policy: 'manager-approval' | 'block'
}

/** Antwort von `businessdays.approveClosedDay` (Edge, panary/panary-core#1133). */
export interface ClosedDayApproval {
  approved: boolean
  businessDayId: string | null
  date: string
  policy: 'manager-approval' | 'block'
  role?: string
}

/** Erkennt `LOCATION_CLOSED_TODAY` (AppError BD_6010) aus dem Ruhetag-Gate der Edge. */
export const isLocationClosedToday = (err: unknown): boolean => {
  const e = err as { code?: unknown; data?: { code?: unknown } } | undefined
  return e?.data?.code === 'BD_6010' || e?.code === 'BD_6010'
}

@Injectable({ providedIn: 'root' })
export class BusinessDayService extends BaseService<BusinessDay> {
  protected override entityLabelKey = 'ENTITY.BUSINESS_DAY'
  protected connectionService = inject(ConnectionService)

  #currentBusinessDay = signal<BusinessDay | null>(null)
  currentBusinessDay = this.#currentBusinessDay.asReadonly()

  constructor() {
    super(inject(ConnectionService).businessDayService, 'businessDayService')
  }

  protected override loadDocuments(): void {
    // Stub
  }

  /**
   * Tag eroeffnen — ruft Edge-Custom-Method `openDay` auf.
   * Kein opening-float mehr: das Wechselgeld gehoert zur Kasse (cash-sessions)
   * und wird beim Eroeffnen der jeweiligen Kasse erfasst.
   */
  async openDay(opts: { locationId?: string | null } = {}): Promise<BusinessDay> {
    const service = this.connectionService.businessDayService as unknown as {
      openDay: (data: unknown) => Promise<BusinessDay>
    }
    const result = await service.openDay({
      locationId: opts.locationId,
    })
    this.#currentBusinessDay.set(result)
    return result
  }

  /**
   * Fehlt heute eine Ruhetag-Freigabe? Bewusst am rohen Service vorbei an
   * `handleError`: Der Aufrufer entscheidet bei einem Fehler selbst (fail-open,
   * das Gate der Edge erzwingt die Regel ohnehin).
   *
   * Ohne angemeldete Verbindung sofort ablehnen: Ein Socket-Aufruf hängt offline, bis die
   * Verbindung zurückkommt. Davor wartete das Anlegen einer Bestellung, und die Offline-Outbox
   * kam nie zum Zug (panary/panary-core#1185).
   */
  async getClosedDayStatus(): Promise<ClosedDayStatus> {
    if (this.connectionService.connectionState().status !== 'authenticated') {
      throw new Error('OFFLINE_CLOSED_DAY_STATUS')
    }
    const service = this.connectionService.businessDayService as unknown as {
      getClosedDayStatus: (data: unknown) => Promise<ClosedDayStatus>
    }
    return service.getClosedDayStatus({})
  }

  /**
   * Ruhetag freigeben — die Edge prüft PIN und Rolle nach der Ruhetag-Regel des
   * Standorts und eröffnet bzw. stempelt den Geschäftstag. Fehler gehen ohne
   * Notification an den Dialog, der sie inline zeigt.
   */
  async approveClosedDay(data: { authorizedByUserId: string; pin: string }): Promise<ClosedDayApproval> {
    const service = this.connectionService.businessDayService as unknown as {
      approveClosedDay: (data: unknown) => Promise<ClosedDayApproval>
    }
    return service.approveClosedDay(data)
  }

  /**
   * Tag schliessen — ruft Edge-Custom-Method `closeDay` auf, die ihrerseits
   * den Cloud-Trigger fuer den Tagesabschluss-Report ausloest.
   */
  async closeDay(opts: {
    businessDayId: string
    countedClosingFloatCents?: number
    cashDropsCents?: number
    payoutsCents?: number
    physicalCounts?: Record<string, number>
  }): Promise<BusinessDay> {
    const service = this.connectionService.businessDayService as unknown as {
      closeDay: (data: unknown) => Promise<BusinessDay>
    }
    const result = await service.closeDay(opts)
    if (!result?.isOpen) this.#currentBusinessDay.set(null)
    return result
  }

  protected override fileReaderOnLoad(
    _fileReader: FileReader,
    _observer: Observer<unknown>,
    _context: {
      errorMessages: string[]
      warnMessages: string[]
      successCount: number
      multi: boolean
    },
  ): void {
    // Stub
  }
}
