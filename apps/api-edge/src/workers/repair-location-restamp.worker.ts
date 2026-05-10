// Auto-Repair-Hook fuer historisch inkonsistente Edge-DBs.
//
// Hintergrund: vor dem preflightSnapshot-Fix lief beim Pairing der
// Location-Restamp ins Leere, weil `connection.locationId` leer war
// (siehe applyCloudTenantId-Aufrufer in cloud-bootstrap-runner.worker.ts).
// Folge: User-Records aus dem Cloud-Pull tragen `activeLocationId =
// Cloud-LocationId`, aber `locations._id` ist noch die alte Edge-LocationId.
// Mismatch → User unsichtbar im Edge-Admin-Panel, POS-Login scheitert.
//
// Dieser Worker prueft beim Edge-Boot:
//   1. Gibt es User mit `activeLocationId`, der NICHT in `locations._id` existiert?
//      → "Geist-Location" detected.
//   2. Hat die `locations`-Tabelle genau einen Eintrag (Single-Location-Edge)?
//   3. Ist die Edge gepairt (`cloud-connection.bootstrapStatus === 'done'`)?
//
// Wenn alle drei zutreffen: applyCloudTenantId(oldLocationId = locations[0]._id,
// newLocationId = Geist-LocationId), fuehrt also den DELETE+INSERT in locations
// und alle FK-Updates in users/products/etc. nachtraeglich durch.
//
// Idempotent: nach dem Repair existiert keine Geist-Location mehr, der naechste
// Boot tut nichts.
//
// Multi-Location-Edge (zukuenftig): Hook bricht ab — die Heuristik "erste
// Location ist die alte" stimmt dann nicht mehr. Manuelle Reparatur noetig.

import { logger } from '@panary-core/shared-backend'

import type { Application } from '../declarations'
import { applyCloudTenantId } from '../utils/apply-cloud-tenant-id'

const cloudConnectionPath = 'cloud-connection'

interface LocationRow {
  _id: string
  tenantId?: string
}

interface UserRow {
  _id: string
  activeLocationId?: string | null
}

interface CloudConnectionRow {
  bootstrapStatus?: string
  pairingStatus?: string
}

export const runLocationRestampRepair = async (app: Application): Promise<void> => {
  try {
    // 1. Edge muss gepairt + bootstrap=done sein. Sonst ist es ein normaler
    //    Pre-Pairing-Zustand und die Inkonsistenz nicht zu reparieren.
    const conn = (await app
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .service(cloudConnectionPath as any)
      .find({
        provider: undefined,
        paginate: false,
        query: { $limit: 1 },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as CloudConnectionRow[] | unknown
    const connList = Array.isArray(conn) ? (conn as CloudConnectionRow[]) : []
    const active = connList[0]
    if (!active || active.bootstrapStatus !== 'done' || active.pairingStatus !== 'connected') {
      return
    }

    // 2. Single-Location-Edge: locations-Tabelle muss genau eine Zeile haben.
    const locations = (await app
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .service('locations' as any)
      .find({
        provider: undefined,
        paginate: false,
        query: { $select: ['_id', 'tenantId'] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as LocationRow[] | unknown
    const locList = Array.isArray(locations) ? (locations as LocationRow[]) : []
    if (locList.length !== 1) {
      // Multi-Location-Edge oder leere DB — kein automatisches Repair.
      return
    }
    const knownLocationId = locList[0]._id

    // 3. Geist-Location-Detection: gibt es User mit activeLocationId, der nicht
    //    in der locations-Tabelle existiert?
    const users = (await app
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .service('users' as any)
      .find({
        provider: undefined,
        paginate: false,
        query: { $select: ['_id', 'activeLocationId'] },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)) as UserRow[] | unknown
    const userList = Array.isArray(users) ? (users as UserRow[]) : []

    const ghostLocationIds = new Set<string>()
    for (const u of userList) {
      const aid = u.activeLocationId
      if (typeof aid === 'string' && aid.length > 0 && aid !== knownLocationId) {
        ghostLocationIds.add(aid)
      }
    }

    if (ghostLocationIds.size === 0) {
      // Konsistent — nichts zu tun.
      return
    }

    if (ghostLocationIds.size > 1) {
      // Mehr als eine Geist-Location → uneindeutig welche die "richtige" ist.
      // Konservativ: nicht reparieren, User muss manuell.
      logger.warn({
        message: 'Auto-Repair-Hook: mehrere Geist-Locations detected — skip',
        event: 'sync.repair.ambiguous',
        ghostLocationIds: Array.from(ghostLocationIds),
        knownLocationId,
      })
      return
    }

    const ghostLocationId = Array.from(ghostLocationIds)[0]
    logger.info({
      message: 'Auto-Repair-Hook: Geist-Location detected, starte Restamp',
      event: 'sync.repair.location_restamp_started',
      oldLocationId: knownLocationId,
      newLocationId: ghostLocationId,
    })

    // 4. Restamp ausfuehren — nur Location, kein Tenant-Restamp (User hat
    //    Tenant beim Pairing erfolgreich umgestempelt; nur die LocationId-Kette
    //    ist gebrochen).
    const result = await applyCloudTenantId(app, {
      oldTenantId: locList[0].tenantId ?? null,
      newTenantId: locList[0].tenantId ?? '',
      oldLocationId: knownLocationId,
      newLocationId: ghostLocationId,
    })

    logger.info({
      message: 'Auto-Repair-Hook: Location-Restamp abgeschlossen',
      event: 'sync.repair.location_restamped',
      oldLocationId: knownLocationId,
      newLocationId: ghostLocationId,
      affectedTables: result.affectedTables,
      updatedRows: result.updatedRows,
    })
  } catch (err) {
    logger.error({
      message: 'Auto-Repair-Hook fehlgeschlagen',
      event: 'sync.repair.failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    })
  }
}
