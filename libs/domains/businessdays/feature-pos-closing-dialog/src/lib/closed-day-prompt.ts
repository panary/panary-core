import type { MatDialog } from '@angular/material/dialog'
import type { BusinessDayService, ClosedDayStatus } from '@panary/businessdays/data-access'
import { firstValueFrom } from 'rxjs'
import { openClosedDayApprovalDialog } from './closed-day-approval-dialog.component'

/**
 * Öffnet den Ruhetag-Freigabe-Dialog (panary/panary-core#1133). Liefert `true`, wenn
 * freigegeben wurde — der Aufrufer wiederholt dann seinen Vorgang.
 */
export async function promptClosedDayApproval(
  matDialog: MatDialog,
  status: Pick<ClosedDayStatus, 'date' | 'policy'>,
  operationMode?: string | null,
): Promise<boolean> {
  const result = await firstValueFrom(
    openClosedDayApprovalDialog(matDialog, { date: status.date, policy: status.policy, operationMode }).afterClosed(),
  )
  return !!result?.approved
}

/**
 * Wie lange die Vorabfrage höchstens warten darf. Ein Server, der `getClosedDayStatus` nicht kennt (die Cloud,
 * eine ältere Edge), beantwortet das Event nie: Der Socket-Client wartet ohne Timeout, und das Anlegen der
 * Bestellung hing stumm (panary/panary-core#1214).
 */
export const CLOSED_DAY_STATUS_TIMEOUT_MS = 3000

/**
 * Vor dem Verkauf: Fehlt heute eine Ruhetag-Freigabe, den Dialog zeigen — solange der
 * Warenkorb noch steht. Liefert `false` nur, wenn die Freigabe nötig war und abgelehnt
 * bzw. abgebrochen wurde.
 *
 * Fail-open, wenn die Vorabfrage scheitert **oder nicht antwortet** (Edge offline, ältere Edge ohne die
 * Methode, Cloud): Erzwungen wird die Regel im Order-Gate des Servers, nicht hier. Eine Antwort, die erst nach
 * dem Timeout eintrifft, wird verworfen und öffnet keinen Dialog mehr.
 */
export async function ensureClosedDayApproval(
  matDialog: MatDialog,
  businessDays: Pick<BusinessDayService, 'getClosedDayStatus'>,
  operationMode?: string | null,
  timeoutMs: number = CLOSED_DAY_STATUS_TIMEOUT_MS,
): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), timeoutMs)
  })
  let status: ClosedDayStatus | 'timeout'
  try {
    status = await Promise.race([businessDays.getClosedDayStatus(), timedOut])
  } catch {
    return true
  } finally {
    clearTimeout(timer)
  }
  if (status === 'timeout') {
    console.warn(`[ClosedDay] Vorabfrage ohne Antwort nach ${timeoutMs} ms, fahre ohne Freigabe-Abfrage fort`)
    return true
  }
  if (!status.approvalRequired) return true
  return promptClosedDayApproval(matDialog, status, operationMode)
}

/**
 * Freigabe aus einem `BD_6010` heraus — der Fehler des Gates trägt Datum und Regel
 * (`data.date`, `data.policy`). Für Wege, die erst am Server merken, dass heute
 * Ruhetag ist (Kassieren einer vorher angelegten Bestellung, Tag eröffnen).
 */
export function promptClosedDayApprovalFromError(
  matDialog: MatDialog,
  error: unknown,
  operationMode?: string | null,
): Promise<boolean> {
  const data = (error as { data?: { date?: unknown; policy?: unknown } } | undefined)?.data
  return promptClosedDayApproval(
    matDialog,
    {
      date: typeof data?.date === 'string' ? data.date : '',
      policy: data?.policy === 'block' ? 'block' : 'manager-approval',
    },
    operationMode,
  )
}
