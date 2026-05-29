import type { Receipt } from './receipt.schema'
import type { BuildReceiptSnapshotInput, ReceiptSnapshotCore } from './receipt-builder'

// Abstraktion analog zu `TsePort` (ADR D7). Die REINEN Teile (generate /
// getDeliveryArtifact) leben hier in der Domain; die I/O-Bindings (persist über
// die Feathers-Adapter-API, print über den ESC/POS-Renderer) sind umgebungs-
// spezifisch und werden im Backend implementiert (Edge/Cloud).

export type ReceiptDeliveryChannel = 'qr' | 'nfc' | 'url' | 'pdf' | 'png' | 'html'

export interface ReceiptDeliveryArtifact {
  channel: ReceiptDeliveryChannel
  contentType: string
  // Bei qr/nfc/url: die Abruf-URL. Bei html: das Markup. Bei pdf/png (Phase 2/3):
  // base64-kodierter Inhalt in `body`.
  url?: string
  body?: string
}

export interface ReceiptDeliveryOptions {
  /** Basis-URL des öffentlichen Abruf-Service, z. B. https://receipts.panary.io */
  baseUrl: string
}

export interface ReceiptProvider {
  /** Reine, deterministische Snapshot-Erzeugung (Source of Truth). */
  generate(input: BuildReceiptSnapshotInput): ReceiptSnapshotCore
  /** Reine Render-/Liefer-Artefakt-Erzeugung für einen Kanal. */
  getDeliveryArtifact(receipt: Receipt, channel: ReceiptDeliveryChannel, options: ReceiptDeliveryOptions): ReceiptDeliveryArtifact
}

// Öffentliche, nicht-enumerierbare Abruf-URL eines Belegs (Token-basiert).
export const buildReceiptUrl = (baseUrl: string, token: string): string =>
  `${baseUrl.replace(/\/+$/, '')}/r/${token}`
