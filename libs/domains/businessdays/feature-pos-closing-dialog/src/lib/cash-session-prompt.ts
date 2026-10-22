import type { MatDialog } from '@angular/material/dialog'
import type { CashSession } from '@panary/businessdays/domain'
import { firstValueFrom } from 'rxjs'
import { openManagerAuthorizeCashSessionDialog } from './manager-authorize-cash-session-dialog.component'

/** Was die Freigabe von der aktiven Filiale braucht — als Struktur, damit Aufrufer keinen Cast schreiben müssen. */
export interface CashSessionPromptLocation {
  currentBusinessDay?: { businessDayId?: string }
  settings?: { cashSessionSettings?: { defaultOpeningFloatCents?: number } }
}

export interface CashSessionPromptUser {
  _id?: string
  firstName?: string
  lastName?: string
}

/**
 * Öffnet den Manager-PIN-Dialog zur Kassen-Freigabe für den Kassierer (BD_6004: keine offene Kasse).
 * Liefert `true`, wenn eine Kasse eröffnet wurde — der Aufrufer wiederholt dann den Abschluss.
 * Ohne Geschäftstag gibt es nichts freizugeben (`false`). Gemeinsam genutzt von „Offene Bestellungen" und
 * der Bezahlansicht der Kasse (core#831), damit beide Wege dieselbe Freigabe zeigen.
 */
export async function promptCashSessionAuthorization(
  matDialog: MatDialog,
  location: CashSessionPromptLocation | undefined,
  users: readonly CashSessionPromptUser[],
  cashierId: string,
): Promise<boolean> {
  const businessDayId = location?.currentBusinessDay?.businessDayId
  if (!businessDayId) return false

  const cashier = users.find(user => user._id === cashierId)
  const cashierName = cashier ? `${cashier.firstName ?? ''} ${cashier.lastName ?? ''}`.trim() : undefined

  const result = await firstValueFrom(
    openManagerAuthorizeCashSessionDialog(matDialog, {
      businessDayId,
      cashierId,
      cashierName: cashierName || undefined,
      defaultOpeningFloatCents: location?.settings?.cashSessionSettings?.defaultOpeningFloatCents,
    }).afterClosed(),
  )
  return !!(result as CashSession | null)
}
