// Einziger Trigger der fiskalischen Signierpflicht (KassenSichV): der
// Betriebsmodus der Location ist `pos-cashier`. Bewusst als geteilter Helfer in
// der Domain-Lib, damit Edge- UND Cloud-Signier-Hooks identisch entscheiden
// (keine doppelte Logik, kein Drift). Der Wert 'pos-cashier' ist der stabile
// LocationOperationMode aus @panary/locations/domain — hier als Literal
// gehalten, um keine Cross-Domain-Abhängigkeit tse→locations einzuführen.
export const FISCAL_OPERATION_MODE = 'pos-cashier'

export const requiresFiscalSignature = (input: { operationMode?: string | null }): boolean =>
  input.operationMode === FISCAL_OPERATION_MODE
