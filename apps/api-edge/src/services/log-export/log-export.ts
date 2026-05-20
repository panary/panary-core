import { authenticate } from '@feathersjs/authentication'

import { authorize, LOG_DIR } from '@panary/shared-backend'

import type { Application } from '../../declarations'
import { buildLogBundle } from '../../utils/log-bundle'

export const logExportPath = 'log-export'
export const logExportMethods = ['find'] as const

export interface LogExportResult {
  filename: string
  contentType: string
  /** SHA-256 (hex) des gzip-Buffers — Integritaetspruefung. */
  sha256: string
  lineCount: number
  fileCount: number
  generatedAt: string
  /** base64-kodiertes gzip-NDJSON (gescrubt). */
  contentBase64: string
}

// Tabellenloser Custom-Service: liefert ein gescrubtes, gzip-komprimiertes
// Bundle der rotierenden Edge-Logdateien zum Download im Admin-Panel.
// KEIN multiTenancy — gelesen werden lokale Logdateien (kein tenant-scoped
// DB-Zugriff); der Edge bedient genau einen Tenant. Zugriff via JWT + RBAC
// (authorize() prueft AppResource.LOG_EXPORT → nur TENANT_OWNER/MANAGER).
const createLogExportService = () => ({
  // Feathers-idiomatisch paginiert (ein Bundle als einziges data-Item), damit der
  // admin-client-ApiService.find() es unveraendert konsumiert.
  async find(): Promise<{ total: number; limit: number; skip: number; data: LogExportResult[] }> {
    const bundle = await buildLogBundle(LOG_DIR)
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const result: LogExportResult = {
      filename: `edge-logs-${stamp}.ndjson.gz`,
      contentType: 'application/gzip',
      sha256: bundle.sha256,
      lineCount: bundle.lineCount,
      fileCount: bundle.fileCount,
      generatedAt: bundle.generatedAt,
      contentBase64: bundle.gzip.toString('base64'),
    }
    return { total: 1, limit: 1, skip: 0, data: [result] }
  },
})

export const logExport = (app: Application) => {
  app.use(logExportPath, createLogExportService() as any, {
    methods: logExportMethods as any,
    events: [],
  })

  app.service(logExportPath).hooks({
    around: {
      all: [authenticate('jwt'), authorize()],
    },
  })
}
