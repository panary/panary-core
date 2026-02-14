import { HookContext } from '../declarations'
import { Forbidden } from '@feathersjs/errors'
import { AppError, AppErrorMessages } from '@panary-core/shared/common'

export const ensureTenantIsolation = () => async (context: HookContext) => {
  // 1. Wenn keine Daten zurückkamen, ist alles gut (nichts zu prüfen)
  if (!context.result) return context

  // 2. Wenn kein User eingeloggt ist (Public Service), können wir keine Tenant-Prüfung machen.
  // (Hier greift die 'publicServices' Liste aus der app.ts, falls der Service public ist)
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
    // Paginierte Antwort
    records = context.result.data
  } else {
    // Einzelnes Objekt (get, create, update...)
    records = [context.result]
  }

  // 5. DAS SICHERHEITSNETZ: Jeden einzelnen Datensatz prüfen
  for (const record of records) {
    // Wir prüfen nur Datensätze, die überhaupt eine tenantId haben.
    // Wenn ein Datensatz KEINE tenantId hat (z.B. System-Config), lassen wir ihn durch
    // (oder blockieren ihn, je nach Strenge. Hier: Durchlassen, wenn global).
    if (record.tenantId) {
      // DER CHECK: Stimmt die ID überein?
      if (record.tenantId !== user.tenantId) {
        // ALARM! Datenleck verhindert.
        // Wir werfen einen harten Fehler. Das Frontend bekommt eine 403.
        console.error(
          `SECURITY ALERT: User ${user._id} (Tenant: ${user.tenantId}) tried to access Record ${record._id} (Tenant: ${record.tenantId}) in service '${context.path}'!`
        )

        throw new Forbidden(AppErrorMessages[AppError.TENANT_MISMATCH], {
          code: AppError.TENANT_MISMATCH
        })
      }
    }
  }

  return context
}
