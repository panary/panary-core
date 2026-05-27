import { inject, Injectable, signal } from '@angular/core'
import { Observer } from 'rxjs'
import { BaseService, ConnectionService } from '@panary/shared/data-access'
import {
  CashSession,
  CashSessionStatus,
  type DenominationCounts,
  OPEN_CASH_SESSION_STATUSES,
} from '@panary/businessdays/domain'

/**
 * POS-Data-Access für Kassen-Sessions (edge-nativ). Der Kassierer eröffnet,
 * zählt und schließt seine Lade offline gegen den Edge-Service `cash-sessions`.
 *
 * BaseService re-throwt nach handleError → jeder Aufruf MUSS in try/catch
 * (siehe Memory feedback_baseservice_rethrow).
 */
@Injectable({ providedIn: 'root' })
export class CashSessionService extends BaseService<CashSession> {
  protected override entityLabelKey = 'ENTITY.CASH_SESSION'
  protected connectionService = inject(ConnectionService)

  /** Kassen des aktuell betrachteten Geschäftstags (für UI-Listen). */
  readonly #sessions = signal<CashSession[]>([])
  readonly sessions = this.#sessions.asReadonly()

  constructor() {
    super(inject(ConnectionService).cashSessionService, 'cashSessionService')
  }

  protected override loadDocuments(): void {
    // Kein globales Auto-Load — Kassen werden je Geschäftstag geladen.
  }

  /** Alle Kassen eines Geschäftstags laden (in Eröffnungs-Reihenfolge). */
  async loadForBusinessDay(businessDayId: string): Promise<CashSession[]> {
    const res = await this.find({
      query: { businessDayId, $sort: { createdAt: 1 }, $limit: 100 },
    })
    const list = Array.isArray(res) ? res : (res?.data ?? [])
    this.#sessions.set(list as CashSession[])
    return list as CashSession[]
  }

  /** Offene (nicht geschlossene) Kasse eines Kassierers für den Tag — oder null. */
  async findOpenForUser(businessDayId: string, openedBy: string): Promise<CashSession | null> {
    const res = await this.find({
      query: {
        businessDayId,
        openedBy,
        status: { $in: [...OPEN_CASH_SESSION_STATUSES] },
        $limit: 1,
      },
    })
    const list = Array.isArray(res) ? res : (res?.data ?? [])
    return (list[0] as CashSession | undefined) ?? null
  }

  /** Kasse eröffnen (Standard-CRUD create — Resolver stempelt _id/status/openedBy/openedAt). */
  async openSession(input: {
    businessDayId: string
    label: string
    openingFloatCents: number
    openedBy?: string
  }): Promise<CashSession> {
    // Server-Resolver stempeln _id/status/openedBy/openedAt + abgeleitete Felder —
    // daher genügt das minimale Create-Shape (Cast über die strikte Omit-Signatur).
    return (await this.create(
      input as unknown as Omit<CashSession, '_id' | 'locationId' | 'tenantId'>,
    )) as CashSession
  }

  /**
   * Manager-autorisierte Kassen-Eröffnung am POS. Ruft die Edge-Custom-Method
   * `openAuthorized` direkt auf — der Server verifiziert den Manager-PIN +
   * Rolle. Fehler (z.B. PIN ungültig) wirft die Methode; der Dialog fängt sie
   * inline ab (läuft NICHT über BaseService.handleError).
   */
  async openAuthorized(input: {
    businessDayId: string
    openedBy: string
    openingFloatCents: number
    label: string
    authorizedByUserId: string
    pin: string
  }): Promise<CashSession> {
    const service = this.connectionService.cashSessionService as unknown as {
      openAuthorized: (data: unknown) => Promise<CashSession>
    }
    return service.openAuthorized(input)
  }

  /** Kasse zählen + schließen — Stückelungen + optionale Entnahmen/Auszahlungen. */
  async closeSession(
    id: string,
    input: {
      denominationCounts: DenominationCounts
      cashDropsCents?: number
      payoutsCents?: number
      notes?: string
    },
  ): Promise<CashSession> {
    return (await this.patch(id, {
      ...input,
      status: CashSessionStatus.CLOSED,
    } as Partial<CashSession>)) as CashSession
  }

  protected override fileReaderOnLoad(
    _fileReader: FileReader,
    _observer: Observer<unknown>,
    _context: { errorMessages: string[]; warnMessages: string[]; successCount: number; multi: boolean },
  ): void {
    // Stub — kein CSV-Import für Kassen.
  }
}
