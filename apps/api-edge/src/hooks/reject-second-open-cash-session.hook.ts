import { Conflict } from '@feathersjs/errors'
import { Mutex } from 'async-mutex'

import { OPEN_CASH_SESSION_STATUSES, type CashSessionStatusType } from '@panary/businessdays/domain'
import { AppError, AppErrorMessages } from '@panary/shared-common'

import type { HookContext, NextFunction } from '../declarations'

// Höchstens eine gleichzeitig offene Lade je Kassierer und Geschäftstag
// (panary/panary-core#714).
//
// `restrictOrderToCashSession` bucht jede Bestellung auf die offene Lade des
// Kassierers und fragt dafür mit `$limit: 1` ohne Sortierung — zwei offene Laden
// machen die Zuordnung zufällig, und der Tagesabschluss bleibt mit
// `open-cash-sessions` blockiert, bis beide geschlossen sind. Schließen und neu
// eröffnen bleibt erlaubt (Ladenwechsel); gesperrt ist nur die zweite OFFENE.
//
// Die Prüfung gilt für jeden Create-Pfad, auch die internen (`openAuthorized`,
// Auto-Open, Admin), nur nicht für Sync-Apply: Dort kommt ein fertiger Stand an,
// den der Edge nicht ablehnen darf.

const mutex = new Mutex()

const isFromSync = (context: HookContext): boolean => Boolean((context.params as { fromSync?: boolean }).fromSync)

/**
 * Around-Hook am `create`: Prüfung und Insert laufen hintereinander, nie
 * verschränkt. Ohne ihn lesen zwei gleichzeitige Eröffnungen beide „keine offene
 * Lade“, bevor die erste gespeichert ist. Der Edge ist single-process, ein
 * Prozess-Mutex genügt (wie `assign-daily-sequence-number.ts`).
 */
export const serializeCashSessionCreate = async (context: HookContext, next: NextFunction): Promise<void> => {
  await mutex.runExclusive(() => next())
}

/**
 * Before-Hook am `create`, hinter `resolveData` — erst dort stehen `openedBy`
 * und `status` fest. Wirft `409 Conflict` mit `AppError.CASH_SESSION_ALREADY_OPEN`
 * und der ID der offenen Lade in `data.cashSessionId`.
 */
export const rejectSecondOpenCashSession = async (context: HookContext): Promise<HookContext> => {
  if (isFromSync(context)) return context

  const data = context.data as
    { businessDayId?: string; openedBy?: string; status?: string; tenantId?: string | null } | undefined
  if (!data?.businessDayId || !data.openedBy) return context
  if (data.status && !OPEN_CASH_SESSION_STATUSES.includes(data.status as CashSessionStatusType)) return context

  const query: Record<string, unknown> = {
    businessDayId: data.businessDayId,
    openedBy: data.openedBy,
    status: { $in: [...OPEN_CASH_SESSION_STATUSES] },
    $limit: 1,
    $select: ['_id'],
  }
  if (data.tenantId) query['tenantId'] = data.tenantId

  const found = (await context.service.find({ query, paginate: false, provider: undefined })) as Array<{ _id: string }>
  const open = Array.isArray(found) ? found[0] : undefined
  if (!open) return context

  throw new Conflict(AppErrorMessages[AppError.CASH_SESSION_ALREADY_OPEN], {
    code: AppError.CASH_SESSION_ALREADY_OPEN,
    cashSessionId: open._id,
  })
}
