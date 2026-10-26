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
 * Vor dem Verkauf: Fehlt heute eine Ruhetag-Freigabe, den Dialog zeigen — solange der
 * Warenkorb noch steht. Liefert `false` nur, wenn die Freigabe nötig war und abgelehnt
 * bzw. abgebrochen wurde.
 *
 * Fail-open, wenn die Vorabfrage scheitert (Edge offline, ältere Edge ohne die Methode):
 * Erzwungen wird die Regel im Order-Gate der Edge, nicht hier. Ohne Edge greift dort
 * ohnehin die Offline-Outbox des POS.
 */
export async function ensureClosedDayApproval(
  matDialog: MatDialog,
  businessDays: Pick<BusinessDayService, 'getClosedDayStatus'>,
  operationMode?: string | null,
): Promise<boolean> {
  let status: ClosedDayStatus
  try {
    status = await businessDays.getClosedDayStatus()
  } catch {
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
