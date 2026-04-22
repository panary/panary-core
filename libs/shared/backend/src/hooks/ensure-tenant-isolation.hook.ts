import { HookContext } from '../declarations'
import { Forbidden } from '@feathersjs/errors'
import { AppError, AppErrorMessages } from '@panary-core/shared-common'
import { logger } from '../logger'

export const ensureTenantIsolation = () => async (context: HookContext) => {
  // 1. Wenn keine Daten zurückkamen, ist alles gut (nichts zu prüfen)
  if (!context.result) return context

  // 2. Wenn kein User eingeloggt ist (Public Service), können wir keine Tenant-Prüfung machen.
  if (!context.params.user) return context

  const { user } = context.params

  // 3. Platform Admins dürfen alles sehen (Bypass)
  if (user.role && user.role.startsWith('platform:')) {
    return context
  }

  // 4. Daten normalisieren (Feathers gibt mal Arrays, mal Objekte, mal Pagination zurück)
  let records: any[] = []

  if (Array.isArray(context.result)) {
    records = context.result
  } else if (context.result.data && Array.isArray(context.result.data)) {
    records = context.result.data
  } else {
    records = [context.result]
  }

  // 5. DAS SICHERHEITSNETZ: Jeden einzelnen Datensatz prüfen
  for (const record of records) {
    if (record.tenantId) {
      if (record.tenantId !== user.tenantId) {
        logger.error({
          message: 'SECURITY ALERT: Tenant isolation breach prevented',
          event: 'security.tenant_mismatch',
          alert: true,
          userId: user._id,
          userTenantId: user.tenantId,
          recordId: record._id,
          recordTenantId: record.tenantId,
          service: context.path,
          method: context.method,
        })

        throw new Forbidden(AppErrorMessages[AppError.TENANT_MISMATCH], {
          code: AppError.TENANT_MISMATCH
        })
      }
    }
  }

  return context
}
