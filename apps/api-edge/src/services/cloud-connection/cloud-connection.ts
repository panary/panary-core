import { authenticate } from '@feathersjs/authentication'
import { hooks as schemaHooks } from '@feathersjs/schema'
import { BadRequest } from '@feathersjs/errors'

import {
  cloudConnectionDataResolver,
  cloudConnectionDataValidator,
  cloudConnectionExternalResolver,
  cloudConnectionPatchResolver,
  cloudConnectionPatchValidator,
  cloudConnectionQueryResolver,
  cloudConnectionQueryValidator,
  cloudConnectionResolver,
} from './cloud-connection.schema'

import type { Application } from '../../declarations'
import type { HookContext } from '../../declarations'
import { authorize } from '../../hooks/authorize.hook'
import { multiTenancy } from '../../hooks/multi-tenancy.hook'
import { createServiceAdapter } from '@panary-core/shared/data-access/server'
import { DatabaseType } from '@panary-core/shared/common'
import {
  cloudConnectionDataSchema,
  cloudConnectionPatchSchema,
  cloudConnectionQuerySchema,
  cloudConnectionSchema,
  PairingStatus,
} from '@panary-core/cloud-connection/domain'
import type { CloudConnection, CloudConnectionService } from './cloud-connection.class'

export const cloudConnectionPath = 'cloud-connection'
export const cloudConnectionMethods = ['find', 'get', 'create', 'patch', 'remove'] as const

export * from './cloud-connection.schema'

/**
 * After-Create-Hook: Führt das Pairing mit der Cloud durch.
 *
 * 1. Validiert die Cloud-URL (HTTPS-Pflicht in Produktion)
 * 2. Sendet den Pairing-Code an die Cloud zur Verifikation
 * 3. Speichert bei Erfolg den cloudToken und aktualisiert den Status
 */
const performCloudPairing = async (context: HookContext) => {
  const result = context.result as CloudConnection
  const data = context.data as any

  if (!data?.cloudUrl || !data?.pairingCode) return context

  const cloudUrl = data.cloudUrl as string

  // HTTPS-Pflicht (außer localhost im Dev-Modus)
  const isLocalhost = cloudUrl.includes('localhost') || cloudUrl.includes('127.0.0.1')
  if (!isLocalhost && !cloudUrl.startsWith('https://')) {
    await context.service.patch(result._id, {}, {
      ...context.params,
      provider: undefined,
      _internalPatch: {
        pairingStatus: PairingStatus.ERROR,
        errorMessage: 'Cloud-URL muss HTTPS verwenden.',
      },
    } as any)
    throw new BadRequest('Cloud-URL muss HTTPS verwenden (außer für localhost).')
  }

  try {
    // HTTP-Request an Cloud senden
    const response = await fetch(`${cloudUrl}/api/edge-pairing/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pairingCode: data.pairingCode,
        edgeIdentity: {
          tenantId: result.tenantId,
          locationId: result.locationId,
          edgeName: data.edgeName || 'Edge-Server',
        },
      }),
      signal: AbortSignal.timeout(15000),
    })

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'Unbekannter Fehler')
      throw new Error(`Cloud-Antwort: ${response.status} — ${errorBody}`)
    }

    const cloudResponse = await response.json()

    // Intern patchen (ohne Provider = interne Anfrage, umgeht RBAC/Multi-Tenancy)
    await context.service._patch(result._id, {
      cloudToken: cloudResponse.cloudToken,
      cloudEdgeId: cloudResponse.cloudEdgeId,
      pairingStatus: PairingStatus.CONNECTED,
      connectedAt: new Date().toISOString(),
      syncEnabled: true,
      errorMessage: null,
    })

    // Ergebnis aktualisieren (ohne cloudToken für den Client)
    context.result = {
      ...result,
      pairingStatus: PairingStatus.CONNECTED,
      connectedAt: new Date().toISOString(),
      syncEnabled: true,
    }
  } catch (error: any) {
    // Bei Fehler: Status auf ERROR setzen
    await context.service._patch(result._id, {
      pairingStatus: PairingStatus.ERROR,
      errorMessage: error.message || 'Verbindung zur Cloud fehlgeschlagen.',
    })

    context.result = {
      ...result,
      pairingStatus: PairingStatus.ERROR,
      errorMessage: error.message || 'Verbindung zur Cloud fehlgeschlagen.',
    }
  }

  return context
}

/**
 * Before-Remove-Hook: Informiert die Cloud über die Entkopplung (Best-Effort).
 */
const notifyCloudOnDisconnect = async (context: HookContext) => {
  try {
    const connection = await context.service._get(context.id!)
    if (connection.cloudToken && connection.cloudUrl && connection.cloudEdgeId) {
      await fetch(`${connection.cloudUrl}/api/edge-pairing/${connection.cloudEdgeId}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${connection.cloudToken}`,
        },
        signal: AbortSignal.timeout(10000),
      }).catch(() => {
        // Best-Effort: Fehler bei der Cloud-Benachrichtigung ignorieren
      })
    }
  } catch {
    // Best-Effort
  }
  return context
}

export const cloudConnection = (app: Application) => {
  const paginate = app.get('paginate')

  const systemConfig = app.get('system') || {}
  const dbType = systemConfig.dbType || DatabaseType.SQLITE

  let Model: any

  if (dbType === DatabaseType.SQLITE) {
    Model = app.get('sqliteClient')
  }

  const service = createServiceAdapter<CloudConnection>(app, {
    name: 'cloud-connection',
    Model,
    paginate,
    id: '_id',
    multi: [],
  }) as unknown as CloudConnectionService

  app.use(cloudConnectionPath, service as any, {
    methods: cloudConnectionMethods,
    events: [],
    docs: {
      description: 'Edge-Cloud-Verbindung verwalten (Pairing, Status, Entkopplung)',
      schemas: {
        cloudConnection: cloudConnectionSchema,
        cloudConnectionData: cloudConnectionDataSchema,
        cloudConnectionPatch: cloudConnectionPatchSchema,
        cloudConnectionQuery: cloudConnectionQuerySchema,
      },
    },
  })

  app.service(cloudConnectionPath).hooks({
    around: {
      all: [
        authenticate('jwt'),
        authorize(),
        multiTenancy({ isolateLocation: false, allowGlobalData: true }),

        schemaHooks.resolveExternal(cloudConnectionExternalResolver),
        schemaHooks.resolveResult(cloudConnectionResolver),
      ],
    },
    before: {
      all: [schemaHooks.validateQuery(cloudConnectionQueryValidator), schemaHooks.resolveQuery(cloudConnectionQueryResolver)],
      find: [],
      get: [],
      create: [schemaHooks.validateData(cloudConnectionDataValidator), schemaHooks.resolveData(cloudConnectionDataResolver)],
      patch: [schemaHooks.validateData(cloudConnectionPatchValidator), schemaHooks.resolveData(cloudConnectionPatchResolver)],
      remove: [notifyCloudOnDisconnect],
    },
    after: {
      all: [],
      create: [performCloudPairing],
    },
    error: {
      all: [],
    },
  })
}
