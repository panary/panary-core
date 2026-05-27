import type { TseDaySignature } from './tse-transaction.schema'
import { TseUnavailableError } from './tse.errors'

// Flache Felder für den TSE-Tagesabschluss auf dem BusinessDay. Bewusst flach
// (nicht eingebettetes JSON), weil der businessdays-Service keine
// JSON-Field-Hooks nutzt — analog zu `reportId`/`closedAt`.
export interface BusinessDayTseFields {
  tseDayStatus: 'signed' | 'failed' | 'unavailable'
  tseDaySignature: string | null
  tseDaySignatureCounter: number | null
  tseDaySimulated: boolean
}

export const dayTseFieldsFromSignature = (signature: TseDaySignature): BusinessDayTseFields => ({
  tseDayStatus: 'signed',
  tseDaySignature: signature.signatureValue,
  tseDaySignatureCounter: signature.signatureCounter,
  tseDaySimulated: signature.simulated,
})

// KassenSichV §146a: ein Ausfall beim Tagesabschluss blockiert das Schließen
// des Geschäftstages NICHT — er wird als 'unavailable' markiert (nachzusignieren).
export const dayTseFieldsFromError = (error: unknown): BusinessDayTseFields => ({
  tseDayStatus: error instanceof TseUnavailableError ? 'unavailable' : 'failed',
  tseDaySignature: null,
  tseDaySignatureCounter: null,
  tseDaySimulated: false,
})
