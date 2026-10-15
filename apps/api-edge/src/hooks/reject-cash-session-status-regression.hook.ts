import { BadRequest, NotFound } from '@feathersjs/errors'

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

  let stored: { status?: string; tenantId?: string | null } | undefined
  try {
    stored = (await context.service.get(context.id, { provider: undefined })) as typeof stored
  } catch (error) {
    // Nur „gibt es nicht" klärt der Adapter selbst; jeder andere Lesefehler darf
    // die Sperre nicht still aufheben.
    if (error instanceof NotFound) return context
    throw error
  }

  // Der Lesezugriff oben ist intern und ungescoped. Eine Lade eines fremden
  // Mandanten beantwortet der Adapter-Scope mit 404 — der Hook darf ihren Status
  // vorher nicht in einer 400 verraten.
  const userTenantId = (context.params.user as { tenantId?: string | null } | undefined)?.tenantId
  if (context.params.provider && userTenantId && stored?.tenantId !== userTenantId) return context

  if (!isCashSessionStatusRegression(stored?.status, nextStatus)) return context

  throw new BadRequest(AppErrorMessages[AppError.CASH_SESSION_STATUS_REGRESSION], {
    code: AppError.CASH_SESSION_STATUS_REGRESSION,
    from: stored?.status,
    to: nextStatus,
  })
}
