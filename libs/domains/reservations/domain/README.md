# reservations-domain

Kanonische Reservation-Entities für panary-cloud (Phase 6 R1+R2):

- **`reservation`** — Reservierungs-Datensatz (Customer + Status-Machine).
- **`reservable-slot`** — Konfigurierter Zeit-Slot pro Wochentag.
- **`table`** — Tisch im Restaurant (Name, Plätze, Bereich).
- **`assertValidTransition`** — Pure-Function über die Status-State-Machine
  (`pending → confirmed | cancelled`, `confirmed → cancelled | no-show`,
  terminal: `cancelled`, `no-show`).
- **`computeCapacity`** — Pure-Function-Helper (Aggregation über aktive Tables
  + Reservations für ein Datum). KEIN eigener Service (siehe D-22).

Hintergrund / Architektur-Entscheidung: siehe
[panary-cloud/.planning/phases/06-reservierung-r1-r2-brand-schicht/06-CONTEXT.md](../../../../../panary-cloud/.planning/phases/06-reservierung-r1-r2-brand-schicht/06-CONTEXT.md)
(D-21..D-24 Reservation-Entities + State-Machine + Capacity-Helper).

## Building

`nx build reservations-domain`

## Running unit tests

`nx test reservations-domain`
