import type {
  DayCloseInput,
  FinishTransactionInput,
  StartTransactionInput,
  TseExportRange,
  TsePort,
} from './tse-port'
import { TseProcessType } from './tse-transaction.schema'
import type {
  TseDaySignature,
  TseExportRef,
  TsePortStatus,
  TseSignature,
  TseTransactionRef,
} from './tse-transaction.schema'
import { TseUnavailableError } from './tse.errors'

const SIMULATOR_PROVIDER = 'SIMULATOR'
const SIGNATURE_ALGORITHM = 'simulated-sha256-v1'

export interface SimulatorFaultConfig {
  /** Simuliert einen TSE-Ausfall: jeder Signiervorgang wirft `TseUnavailableError` (§146a-Pfad). */
  outage?: boolean
  /** Künstliche Latenz je Aufruf in ms — für Timeout-/Resilienz-Tests. */
  latencyMs?: number
}

const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

// Bewusst NICHT-kryptografisch: ein deterministischer, klar als simuliert
// erkennbarer Platzhalter. Echte Signaturen liefert erst der Provider-Adapter.
const fakeSignature = (parts: ReadonlyArray<string | number>): string =>
  `SIM-${Buffer.from(parts.join('|')).toString('base64')}`

// Deterministischer, in-memory TSE-Simulator für Dev/CI/Staging.
// Erzeugt KEINE fiskalisch gültigen Signaturen (`simulated: true`). Persistenz
// und ein standalone HTTP-Gateway sind dokumentierte Folgephasen.
export class SimulatorTseAdapter implements TsePort {
  private signatureCounter = 0
  private lastSignedAt: string | undefined
  private fault: SimulatorFaultConfig = {}

  // Steuert das Ausfall-/Latenz-Verhalten — für deterministische Tests des
  // §146a-Ausfall-Pfads.
  setFault(fault: SimulatorFaultConfig): void {
    this.fault = { ...fault }
  }

  async getStatus(): Promise<TsePortStatus> {
    // getStatus signiert nicht und löst daher KEINEN Ausfall aus — es meldet ihn nur.
    return {
      provider: SIMULATOR_PROVIDER,
      healthy: this.fault.outage !== true,
      signatureCounter: this.signatureCounter,
      lastSignedAt: this.lastSignedAt,
      simulated: true,
    }
  }

  async startTransaction(input: StartTransactionInput): Promise<TseTransactionRef> {
    await this.guard()
    this.signatureCounter += 1
    return {
      transactionNumber: input.transactionNumber,
      clientId: input.clientId,
      startedAt: new Date().toISOString(),
      provider: SIMULATOR_PROVIDER,
      simulated: true,
    }
  }

  async finishTransaction(ref: TseTransactionRef, input: FinishTransactionInput): Promise<TseSignature> {
    await this.guard()
    return this.sign(ref.transactionNumber, TseProcessType.RECEIPT, [ref.transactionNumber, input.amountCents])
  }

  async cancelTransaction(ref: TseTransactionRef): Promise<TseSignature> {
    await this.guard()
    return this.sign(ref.transactionNumber, TseProcessType.OTHER, [ref.transactionNumber, 'cancel'])
  }

  async signDayClose(input: DayCloseInput): Promise<TseDaySignature> {
    await this.guard()
    this.signatureCounter += 1
    const logTime = new Date().toISOString()
    this.lastSignedAt = logTime
    return {
      businessDayId: input.businessDayId,
      signatureCounter: this.signatureCounter,
      signatureValue: fakeSignature([this.signatureCounter, input.businessDayId, input.closedAt]),
      closedAt: input.closedAt,
      simulated: true,
    }
  }

  async export(range: TseExportRange): Promise<TseExportRef> {
    await this.guard()
    return {
      exportId: `sim-export-${range.from}_${range.to}`,
      format: 'DSFINV_K',
      createdAt: new Date().toISOString(),
      simulated: true,
    }
  }

  private sign(transactionNumber: number, processType: string, parts: ReadonlyArray<string | number>): TseSignature {
    this.signatureCounter += 1
    const logTime = new Date().toISOString()
    this.lastSignedAt = logTime
    return {
      transactionNumber,
      signatureCounter: this.signatureCounter,
      signatureValue: fakeSignature([this.signatureCounter, logTime, ...parts]),
      signatureAlgorithm: SIGNATURE_ALGORITHM,
      logTime,
      processType,
      simulated: true,
    }
  }

  private async guard(): Promise<void> {
    if (this.fault.latencyMs !== undefined && this.fault.latencyMs > 0) {
      await delay(this.fault.latencyMs)
    }
    if (this.fault.outage === true) {
      throw new TseUnavailableError('Simulierter TSE-Ausfall')
    }
  }
}
