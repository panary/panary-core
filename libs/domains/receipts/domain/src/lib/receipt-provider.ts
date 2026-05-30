import type { Receipt } from './receipt.schema'
import { buildReceiptHtml, type BuildReceiptSnapshotInput, type ReceiptSnapshotCore } from './receipt-builder'

// Abstraktion analog zu `TsePort` (ADR D7). Die REINEN Teile (generate /
// getDeliveryArtifact) leben hier in der Domain; die I/O-Bindings (persist über
// die Feathers-Adapter-API, print über den ESC/POS-Renderer) sind umgebungs-
// spezifisch und werden im Backend implementiert (Edge/Cloud).

export type ReceiptDeliveryChannel = 'qr' | 'nfc' | 'url' | 'wallet' | 'pdf' | 'png' | 'html'

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

/**
 * Reine, deterministische Liefer-Artefakt-Erzeugung je Kanal (konkrete
 * `ReceiptProvider.getDeliveryArtifact`-Implementierung). Isomorph/browser-safe.
 *
 * - qr / url / wallet → die Beleg-URL (QR kodiert sie; der Wallet-Pass verlinkt
 *   aktuell auf sie — echte .pkpass/Google-Pass-Erzeugung braucht Apple/Google-
 *   Zertifikate + SDK und ist ein Folge-Schritt).
 * - nfc → NDEF-URI-Record-Payload (überträgt den Link, nicht den Bon; das
 *   eigentliche NDEF-Schreiben passiert geräteseitig via Web NFC / native).
 * - html → render-on-demand HTML aus dem Snapshot.
 * - pdf / png → binäre Render-Formate; benötigen eine Renderer-Dependency (O3,
 *   kein Paket ohne Zustimmung) → Folge-Schritt.
 */
export const getReceiptDeliveryArtifact = (
  receipt: Receipt,
  channel: ReceiptDeliveryChannel,
  options: ReceiptDeliveryOptions,
): ReceiptDeliveryArtifact => {
  const url = buildReceiptUrl(options.baseUrl, receipt.token)
  switch (channel) {
    case 'qr':
    case 'url':
    case 'wallet':
      return { channel, contentType: 'text/uri-list', url }
    case 'nfc':
      return { channel, contentType: 'application/vnd.nfc.ndef.uri', url }
    case 'html':
      return { channel, contentType: 'text/html; charset=utf-8', body: buildReceiptHtml(receipt) }
    case 'pdf':
    case 'png':
      throw new Error(`Beleg-Kanal '${channel}' benötigt eine Renderer-Dependency (Folge-Schritt)`)
    default:
      throw new Error(`Unbekannter Beleg-Liefer-Kanal: ${String(channel)}`)
  }
}
