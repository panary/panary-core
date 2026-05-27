import type {
  TseDaySignature,
  TseExportRef,
  TsePortStatus,
  TseSignature,
  TseTransactionRef,
} from './tse-transaction.schema'

export interface StartTransactionInput {
  /** Geräte-/Kassen-Kennung (KassenSichV ClientId). */
  clientId: string
  /** Lückenlose Vorgangsnummer — entspricht `order.dailySequenceNumber`. */
  transactionNumber: number
  processType?: string
  /** Serialisierte Prozessdaten (Bon-Zeilen). Im Skelett optional. */
  processData?: string
}

export interface FinishTransactionInput {
  amountCents: number
  paymentType?: string
  processData?: string
}

export interface DayCloseInput {
  businessDayId: string
  closedAt: string
}

export interface TseExportRange {
  /** ISO-8601 Start (inklusiv). */
  from: string
  /** ISO-8601 Ende (inklusiv). */
  to: string
}

// Provider-agnostischer Vertrag für die Fiskalisierung (KassenSichV/RKSV).
// Implementierungen: `SimulatorTseAdapter` (Dev/CI/Staging), künftig ein
// `FiskalyAdapter` u. a. Methoden werfen `TseUnavailableError` (transient,
// §146a-Ausfall) bzw. `TseError` (terminal).
export interface TsePort {
  getStatus(): Promise<TsePortStatus>
  startTransaction(input: StartTransactionInput): Promise<TseTransactionRef>
  finishTransaction(ref: TseTransactionRef, input: FinishTransactionInput): Promise<TseSignature>
  cancelTransaction(ref: TseTransactionRef): Promise<TseSignature>
  signDayClose(input: DayCloseInput): Promise<TseDaySignature>
  export(range: TseExportRange): Promise<TseExportRef>
}
