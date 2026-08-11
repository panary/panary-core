// Einziger Trigger der fiskalischen Signierpflicht (KassenSichV): der
// `operationMode`-Snapshot des GESCHÄFTSTAGS ist `pos-cashier` — nicht die
// aktuelle Betriebsart der Location. Der Snapshot wird bei Eröffnung aus der
// Location abgeleitet und friert damit ein: Eine Umstellung um 10:00 lässt den
// laufenden Tag unverändert weiter signieren. Dass er serverseitig abgeleitet
// und nicht aus der Anfrage bestimmbar ist, regelt ADR 0026. Bewusst als
// geteilter Helfer in der Domain-Lib, damit Edge- UND Cloud-Signier-Hooks
// identisch entscheiden (keine doppelte Logik, kein Drift). Der Wert
// 'pos-cashier' ist derselbe String in BusinessDayOperationMode und
// LocationOperationMode — hier als Literal gehalten, um keine
// Cross-Domain-Abhängigkeit tse→businessdays/locations einzuführen.
export const FISCAL_OPERATION_MODE = 'pos-cashier'

export const requiresFiscalSignature = (input: { operationMode?: string | null }): boolean =>
  input.operationMode === FISCAL_OPERATION_MODE

// Felder, die die Order-Signier-Hooks aus dem Geschäftstag lesen: `operationMode`
// entscheidet das Fiskal-Gate, tenantId/locationId liefern den Scope für den
// lückenlosen Fiskal-Zähler — ein Read deckt beides ab.
export const FISCAL_GATE_BUSINESS_DAY_SELECT = ['operationMode', 'tenantId', 'locationId'] as const

export interface BusinessDayFiscalSnapshot {
  operationMode?: string | null
  tenantId?: string
  locationId?: string | null
}

export interface FiscalSignContext {
  /** Soll der Vorgang fiskalisch signiert werden (pos-cashier)? */
  sign: boolean
  /** Authoritative Scope-Felder aus dem Geschäftstag-Snapshot (für den Zähler). */
  tenantId?: string
  locationId?: string
}

// Reine Gate-Entscheidung aus einem (ggf. unvollständigen) Geschäftstag-Snapshot.
// fail-safe Richtung Signatur: fehlt der operationMode, wird signiert. Ein
// unsignierter pos-cashier-Bon ist ein Compliance-Defekt (KassenSichV §146a),
// ein über-signierter orders-only-Bon nur Verschwendung. Erst ein DEFINITIV als
// 'orders-only' gelesener Snapshot unterdrückt die Signatur.
export const fiscalSignContextFromBusinessDay = (
  businessDay: BusinessDayFiscalSnapshot | undefined,
): FiscalSignContext => {
  const tenantId = businessDay?.tenantId
  const locationId = businessDay?.locationId ?? undefined
  if (!businessDay?.operationMode) return { sign: true, tenantId, locationId }
  return { sign: requiresFiscalSignature({ operationMode: businessDay.operationMode }), tenantId, locationId }
}

// Fiskal-Gate-Quelle: der `operationMode`-Snapshot des Geschäftstags (von openDay
// aus der Location übernommen, mit pos-cashier-Default falls die Location nicht
// ladbar war). Bewusst dieselbe Quelle wie die Tagesabschluss-Signierung →
// Order- und Tagesabschluss-Signierung entscheiden konsistent. Transportneutral:
// der Aufrufer liefert den Loader (Edge: SQLite-Service, Cloud: Mongo-Service).
// fail-safe Richtung Signatur: kein businessDayId oder Lookup-Fehler → signieren.
export const resolveFiscalSignContext = async (
  businessDayId: string | undefined,
  loadBusinessDay: (businessDayId: string) => Promise<BusinessDayFiscalSnapshot | undefined>,
): Promise<FiscalSignContext> => {
  if (!businessDayId) return { sign: true }
  try {
    return fiscalSignContextFromBusinessDay(await loadBusinessDay(businessDayId))
  } catch {
    return { sign: true }
  }
}
