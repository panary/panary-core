// DSFinV-K-Export — Gerüst.
//
// ⚠️ Dies ist eine FOUNDATION, KEINE voll DSFinV-K-konforme Implementierung.
// Der offizielle DSFinV-K-Export ist ein TAR-Archiv mit ~30 CSV-Tabellen +
// index.xml + dem TSE-Export gemäß Taxonomie. Hier modellieren wir den
// reusable Kern: Export-Metadaten + die signierten Transaktionen + den
// Tagesabschluss, plus eine CSV-Serialisierung der Transaktionstabelle. Die
// vollständige Tabellen-/Format-Konformität braucht die offizielle Spec +
// Validierungs-Tools (DSFinV-K-Prüftool) und folgt mit dem echten Provider.

export const DSFINVK_TAXONOMY_VERSION = '2.3'

export interface DsfinvkExportOrder {
  transactionNumber: number
  recordedAt: string
  grossAmountCents: number
  tseStatus: string
  tseSignatureCounter?: number | null
  tseSignatureValue?: string | null
  tseLogTime?: string | null
}

export interface DsfinvkDayClose {
  signatureCounter: number | null
  signatureValue: string | null
  closedAt: string
  status: string
}

export interface DsfinvkExportInput {
  businessDayId: string
  tenantId: string
  locationId: string | null
  from: string
  to: string
  taxonomyVersion?: string
  simulated: boolean
  orders: DsfinvkExportOrder[]
  dayClose?: DsfinvkDayClose | null
}

export interface DsfinvkExportMeta {
  taxonomyVersion: string
  businessDayId: string
  tenantId: string
  locationId: string | null
  from: string
  to: string
  generatedAt: string
  orderCount: number
  signedCount: number
  simulated: boolean
}

export interface DsfinvkExport {
  meta: DsfinvkExportMeta
  transactions: DsfinvkExportOrder[]
  dayClose: DsfinvkDayClose | null
}

export const assembleDsfinvkExport = (input: DsfinvkExportInput): DsfinvkExport => ({
  meta: {
    taxonomyVersion: input.taxonomyVersion ?? DSFINVK_TAXONOMY_VERSION,
    businessDayId: input.businessDayId,
    tenantId: input.tenantId,
    locationId: input.locationId,
    from: input.from,
    to: input.to,
    generatedAt: new Date().toISOString(),
    orderCount: input.orders.length,
    signedCount: input.orders.filter(o => o.tseStatus === 'signed').length,
    simulated: input.simulated,
  },
  transactions: input.orders,
  dayClose: input.dayClose ?? null,
})

const CSV_SEP = ';'

const escapeCsv = (value: string | number | null | undefined): string => {
  const s = value == null ? '' : String(value)
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

// Serialisiert die Transaktionstabelle als (semikolon-getrenntes) CSV. Spalten
// sind ein repräsentatives DSFinV-K-Subset — die offiziellen Tabellennamen
// weichen ab (Anpassung mit der vollständigen Taxonomie-Umsetzung).
export const tseTransactionsToCsv = (orders: ReadonlyArray<DsfinvkExportOrder>): string => {
  const header = [
    'transaktionsnummer',
    'zeitpunkt',
    'betrag_brutto_cents',
    'tse_status',
    'tse_signaturzaehler',
    'tse_signatur',
    'tse_zeit',
  ]
  const rows = orders.map(o =>
    [
      o.transactionNumber,
      o.recordedAt,
      o.grossAmountCents,
      o.tseStatus,
      o.tseSignatureCounter ?? '',
      o.tseSignatureValue ?? '',
      o.tseLogTime ?? '',
    ]
      .map(escapeCsv)
      .join(CSV_SEP),
  )
  return [header.join(CSV_SEP), ...rows].join('\n')
}
