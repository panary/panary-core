import type { Static } from '@feathersjs/typebox'
import { StringEnum, Type } from '@feathersjs/typebox'

import { ClockSkewStatus } from '@panary/cloud-edges/domain'

export const CLOCK_SKEW_WARN_MS = 30_000
export const CLOCK_SKEW_ERROR_MS = 5 * 60_000

export const syncHeartbeatRequestSchema = Type.Object(
  {
    edgeTimestamp: Type.String({ format: 'date-time' }),
    edgeClockMonotonicMs: Type.Number({ minimum: 0 }),
    edgeVersion: Type.Optional(Type.String({ maxLength: 50 })),
    // TOTES FELD — wird nirgends gesendet und nirgends gelesen.
    //
    // Der Edge befuellt es nicht (`runHeartbeat` in
    // `cloud-sync-scheduler.worker.ts` baut den Body ohne es), die Cloud
    // verwirft es (`buildHeartbeatService` liest es nicht), und im
    // cloud-seitigen `cloudEdgeSchema` existiert es ueberhaupt nicht.
    //
    // **Als Gate gesperrt.** Es war einmal als Datenquelle vorgesehen, um den
    // Tagesabschluss zu blockieren, solange die Outbox nicht leer ist. Das ist
    // verworfen: der Wert waere eine Selbstauskunft von Kundenhardware
    // (`trustTier: unverified`) — ein Edge, der 0 meldet, gaebe den Abschluss
    // trotz fehlender Daten frei; einer, der eine grosse Zahl meldet,
    // blockierte den Ladenschluss dauerhaft. Siehe
    // `panary-cloud/docs/adr/0030-edge-geraetezaehlung-ueber-heartbeat.md` und
    // `panary-cloud/docs/adr/0032-tagesabschluss-vollstaendigkeit-ohne-selbstauskunft.md`.
    //
    // Nicht entfernt, weil das einen Core-Release samt Pin-Bump in der Cloud
    // kostete — an einer Datei, deren Nachbarschaft die ganze Edge-Flotte in
    // den Notfall-Modus kippen kann. Streichung beim naechsten ohnehin
    // faelligen Release.
    outboxBacklog: Type.Optional(Type.Integer({ minimum: 0 })),
    // Geraetezaehlung des Edge-LAN (POS/KDS am Edge). Die Cloud kennt diese
    // Clients nicht — sie halten ihren Socket zum Edge, nie zur Cloud — und
    // kann sie ohne diese Meldung nicht anzeigen.
    //
    // Verschachtelt statt flach (anders als `outboxBacklog`), weil die zwei
    // Zahlen nur GEMEINSAM interpretierbar sind: kaeme nur `online` durch,
    // muesste die Cloud einen halben Report verarbeiten. Das Type.Object macht
    // die Praesenz atomar.
    //
    // ⚠️ Dieses Schema ist auf dem Heartbeat-Pfad KEIN Laufzeit-Gate, sondern
    // Typ- und Dokumentationswert: api-cloud registriert `sync-heartbeat`
    // bewusst ohne `validateData`. Das ist kein Versehen — ein 400 im Heartbeat
    // zaehlt am Edge `consecutiveHeartbeatFailures` hoch und aktiviert nach drei
    // Fehlversuchen bzw. fuenf Minuten den Notfall-Modus. Eine
    // Schema-Verschaerfung wuerde die Kundenflotte umlegen statt einen Wert
    // abzulehnen. Die verbindliche Pruefung sitzt in der Cloud
    // (services/sync/edge-device-counts.ts).
    deviceConnections: Type.Optional(
      Type.Object(
        {
          online: Type.Integer({ minimum: 0, maximum: 1000 }),
          total: Type.Integer({ minimum: 0, maximum: 1000 }),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: 'SyncHeartbeatRequest', additionalProperties: false },
)

export type SyncHeartbeatRequest = Static<typeof syncHeartbeatRequestSchema>

export const syncHeartbeatResponseSchema = Type.Object(
  {
    serverTimestamp: Type.String({ format: 'date-time' }),
    clockSkewStatus: StringEnum(Object.values(ClockSkewStatus)),
    clockSkewMs: Type.Number(),
    nextToken: Type.Optional(Type.String({ maxLength: 512 })),
    nextTokenExpiresAt: Type.Optional(Type.String({ format: 'date-time' })),
    pullSince: Type.Optional(Type.String({ format: 'date-time' })),
  },
  { $id: 'SyncHeartbeatResponse', additionalProperties: false },
)

export type SyncHeartbeatResponse = Static<typeof syncHeartbeatResponseSchema>
