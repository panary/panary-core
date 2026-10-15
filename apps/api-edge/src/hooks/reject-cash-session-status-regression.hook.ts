import { BadRequest } from '@feathersjs/errors'

import { isCashSessionStatusRegression } from '@panary/businessdays/domain'
import { AppError, AppErrorMessages } from '@panary/shared-common'

import type { HookContext } from '../declarations'

// Eine Lade geht nur vorwärts: open → counting → closed → audited
// (panary/panary-core#717).
//
// Vorher ließ `cash-sessions.patch` jeden Status zu. Eine geschlossene Lade
// zurück auf `open` änderte einen abgerechneten Kassenstand und öffnete am
// create-Schutz aus #714 vorbei eine zweite Lade desselben Kassierers.
//
// Gilt für jeden Patch-Pfad außer Sync-Apply: Dort kommt ein fertiger Stand an,
// den der Edge nicht ablehnen darf.

const isFromSync = (context: HookContext): boolean => Boolean((context.params as { fromSync?: boolean }).fromSync)

/** Before-Hook am `patch`. Wirft `400` mit `AppError.CASH_SESSION_STATUS_REGRESSION`. */
export const rejectCashSessionStatusRegression = async (context: HookContext): Promise<HookContext> => {
  if (isFromSync(context)) return context

  const nextStatus = (context.data as { status?: string } | undefined)?.status
  if (!nextStatus || context.id == null) return context

  let stored: { status?: string } | undefined
  try {
    stored = (await context.service.get(context.id, { provider: undefined })) as { status?: string }
  } catch {
    // Not-Found u. ä. klärt der Adapter.
    return context
  }

  if (!isCashSessionStatusRegression(stored?.status, nextStatus)) return context

  throw new BadRequest(AppErrorMessages[AppError.CASH_SESSION_STATUS_REGRESSION], {
    code: AppError.CASH_SESSION_STATUS_REGRESSION,
    from: stored?.status,
    to: nextStatus,
  })
}
