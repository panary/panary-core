// Auto-Repair-Hook fuer historisch inkonsistente Edge-DBs.
//
// Hintergrund: vor dem preflightSnapshot-Fix lief beim Pairing der
// Location-Restamp ins Leere, weil `connection.locationId` leer war
// (siehe applyCloudTenantId-Aufrufer in cloud-bootstrap-runner.worker.ts).
// Folge: `locations._id` ist noch die alte Edge-LocationId, waehrend die Cloud
// (und der `/sync-pull?service=locations`-Filter `_id = cloudLocationId`) mit
// der Cloud-LocationId arbeitet — die Edge-Location wird nie gepatcht,
// Standort-Settings (Drucker/Pager/Tische/Oeffnungszeiten) bleiben Defaults;
// Cloud-gepullte User mit `activeLocationId = Cloud-Id` sind unsichtbar.
//
// Dieser Worker prueft beim Edge-Boot (VOR dem ersten Sync-Zyklus, siehe
// Reihenfolge in main.ts):
//   1. Ist die Edge gepairt (`cloud-connection.bootstrapStatus === 'done'`)?
//   2. Hat die `locations`-Tabelle genau einen Eintrag (Single-Location-Edge)?
//   3a. Primaer: Weicht `locations[0]._id` von der Cloud-LocationId aus dem
//       Pairing ab (`preflightSnapshot.cloudLocationId`, Fallback
//       `connection.locationId`)? → deterministische Geist-Location.
//   3b. Fallback (alte Connections ohne Snapshot): Gibt es User mit
//       `activeLocationId`, der NICHT in `locations._id` existiert?
//
// Wenn ja: applyCloudTenantId(oldLocationId = locations[0]._id,
// newLocationId = Cloud-LocationId) — DELETE+INSERT in locations plus alle
// FK-Updates. Danach werden die Pull-Cursors der location-gebundenen
// Master-Data-Services geloescht, damit der naechste Sync-Zyklus die
// Cloud-Location + Feiertage voll zieht (der fortgeschrittene `since`-Cursor
// wuerde die waehrend des Defekts verpassten Records sonst nie nachholen).
//
// Idempotent: nach dem Repair stimmt `locations._id` mit der Cloud ueberein,
// der naechste Boot tut nichts.
//
// Multi-Location-Edge (zukuenftig): Hook bricht ab — die Heuristik "erste
// Location ist die alte" stimmt dann nicht mehr. Manuelle Reparatur noetig.

import { logger } from '@panary/shared-backend'

import type { Application } from '../declarations'
import { applyCloudTenantId } from '../utils/apply-cloud-tenant-id'

const cloudConnectionPath = 'cloud-connection'
const syncCursorPath = 'sync-cursor'

// Nach einem Location-Restamp neu zu ziehende Pull-Services: beide sind an die
// Cloud-LocationId gebunden und waren waehrend des Id-Mismatch nicht anwendbar.
const CURSOR_RESET_SERVICES = ['locations', 'opening-hour-exceptions']

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
  locationId?: string | null
  preflightSnapshot?: { cloudLocationId?: string } | null
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

    // 3a. Primaere Detection: Cloud-LocationId aus dem Pairing-Snapshot.
    //     Deterministisch — braucht keine User-Heuristik und greift auch, wenn
    //     alle User tenant-weit sind (activeLocationId null).
    const cloudLocationId = active.preflightSnapshot?.cloudLocationId ?? active.locationId ?? null
    let targetLocationId: string | null = null

    if (typeof cloudLocationId === 'string' && cloudLocationId.length > 0) {
      if (cloudLocationId === knownLocationId) {
        // Konsistent — nichts zu tun.
        return
      }
      targetLocationId = cloudLocationId
    } else {
      // 3b. Fallback (alte Connections ohne Snapshot): gibt es User mit
      //     activeLocationId, der nicht in der locations-Tabelle existiert?
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

      targetLocationId = Array.from(ghostLocationIds)[0]
    }

    logger.info({
      message: 'Auto-Repair-Hook: Geist-Location detected, starte Restamp',
      event: 'sync.repair.location_restamp_started',
      oldLocationId: knownLocationId,
      newLocationId: targetLocationId,
    })

    // 4. Restamp ausfuehren — nur Location, kein Tenant-Restamp (User hat
    //    Tenant beim Pairing erfolgreich umgestempelt; nur die LocationId-Kette
    //    ist gebrochen).
    const result = await applyCloudTenantId(app, {
      oldTenantId: locList[0].tenantId ?? null,
      newTenantId: locList[0].tenantId ?? '',
      oldLocationId: knownLocationId,
      newLocationId: targetLocationId,
    })

    logger.info({
      message: 'Auto-Repair-Hook: Location-Restamp abgeschlossen',
      event: 'sync.repair.location_restamped',
      oldLocationId: knownLocationId,
      newLocationId: targetLocationId,
      affectedTables: result.affectedTables,
      updatedRows: result.updatedRows,
    })

    // 5. Pull-Cursors der location-gebundenen Services zuruecksetzen: waehrend
    //    des Id-Mismatch gepullte (und verworfene bzw. nie applyable) Records
    //    liegen VOR dem aktuellen `since`-Cursor — ohne Reset wuerden sie erst
    //    bei der naechsten Cloud-Aenderung wieder auftauchen. Der Initial-Pull
    //    ist idempotent (upsert), der Reset also gefahrlos.
    for (const service of CURSOR_RESET_SERVICES) {
      await (app
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .service(syncCursorPath as any)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .remove(`cloud:${service}`, { provider: undefined } as any)
        .catch(() => undefined))
    }
  } catch (err) {
    logger.error({
      message: 'Auto-Repair-Hook fehlgeschlagen',
      event: 'sync.repair.failed',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    })
  }
}
