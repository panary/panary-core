import type { Static } from '@feathersjs/typebox'
import { StringEnum, Type } from '@feathersjs/typebox'

// KassenSichV-Prozesstyp. Im Skelett bewusst schlank gehalten — die vollständige
// Prozesstyp-/ProcessData-Spezifikation kommt mit dem echten Provider-Adapter.
export const TseProcessType = {
  RECEIPT: 'Kassenbeleg-V1',
  OTHER: 'SonstigerVorgang',
} as const
export type TseProcessTypeValue = (typeof TseProcessType)[keyof typeof TseProcessType]

// Referenz auf eine gestartete (noch nicht abgeschlossene) TSE-Transaktion.
export const tseTransactionRefSchema = Type.Object(
  {
    transactionNumber: Type.Number({ minimum: 0 }),
    clientId: Type.String({ minLength: 1, maxLength: 200 }),
    startedAt: Type.String({ format: 'date-time' }),
    provider: Type.String({ minLength: 1, maxLength: 40 }),
    simulated: Type.Boolean(),
  },
  { $id: 'TseTransactionRef', additionalProperties: false },
)
export type TseTransactionRef = Static<typeof tseTransactionRefSchema>

// Signatur eines abgeschlossenen Einzelvorgangs (Bon/Storno).
export const tseSignatureSchema = Type.Object(
  {
    transactionNumber: Type.Number({ minimum: 0 }),
    signatureCounter: Type.Number({ minimum: 0 }),
    signatureValue: Type.String({ minLength: 1 }),
    signatureAlgorithm: Type.String({ minLength: 1, maxLength: 80 }),
    logTime: Type.String({ format: 'date-time' }),
    processType: Type.String({ minLength: 1, maxLength: 60 }),
    simulated: Type.Boolean(),
  },
  { $id: 'TseSignature', additionalProperties: false },
)
export type TseSignature = Static<typeof tseSignatureSchema>

// Signatur des Tagesabschlusses (Z-Bon).
export const tseDaySignatureSchema = Type.Object(
  {
    businessDayId: Type.String({ minLength: 1, maxLength: 80 }),
    signatureCounter: Type.Number({ minimum: 0 }),
    signatureValue: Type.String({ minLength: 1 }),
    closedAt: Type.String({ format: 'date-time' }),
    simulated: Type.Boolean(),
  },
  { $id: 'TseDaySignature', additionalProperties: false },
)
export type TseDaySignature = Static<typeof tseDaySignatureSchema>

// Laufzeit-Status der TSE (Health, Signatur-Zähler) — NICHT zu verwechseln mit
// dem Account-Konfigurations-`TseStatus` aus `@panary/tenants/domain`.
export const tsePortStatusSchema = Type.Object(
  {
    provider: Type.String({ minLength: 1, maxLength: 40 }),
    healthy: Type.Boolean(),
    signatureCounter: Type.Number({ minimum: 0 }),
    certExpiresAt: Type.Optional(Type.String({ format: 'date-time' })),
    lastSignedAt: Type.Optional(Type.String({ format: 'date-time' })),
    simulated: Type.Boolean(),
  },
  { $id: 'TsePortStatus', additionalProperties: false },
)
export type TsePortStatus = Static<typeof tsePortStatusSchema>

// Referenz auf einen erzeugten Export (DSFinV-K / TAR).
export const tseExportRefSchema = Type.Object(
  {
    exportId: Type.String({ minLength: 1, maxLength: 120 }),
    format: StringEnum(['DSFINV_K', 'TAR']),
    createdAt: Type.String({ format: 'date-time' }),
    simulated: Type.Boolean(),
  },
  { $id: 'TseExportRef', additionalProperties: false },
)
export type TseExportRef = Static<typeof tseExportRefSchema>
