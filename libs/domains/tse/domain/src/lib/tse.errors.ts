// Fehlerklassen des TSE-Ports.
//
// Die Unterscheidung transient vs. terminal ist zentral für das
// KassenSichV-§146a-Ausfall-Handling: `TseUnavailableError` bedeutet „TSE
// gerade nicht erreichbar" → der Verkauf darf weiterlaufen, die Signatur wird
// nachgeholt und der Ausfall dokumentiert. `TseError` ist ein endgültiger
// Fehler (Konfiguration/Vertrag/Provider) und sollte den Vorgang abbrechen.

export class TseError extends Error {
  readonly code: string

  constructor(message: string, code = 'TSE_ERROR') {
    super(message)
    this.name = 'TseError'
    this.code = code
  }
}

export class TseUnavailableError extends TseError {
  constructor(message = 'TSE momentan nicht erreichbar') {
    super(message, 'TSE_UNAVAILABLE')
    this.name = 'TseUnavailableError'
  }
}
