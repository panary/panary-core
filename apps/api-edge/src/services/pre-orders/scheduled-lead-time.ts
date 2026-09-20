/**
 * Vorlaufzeit einer konvertierten Vorbestellung in Minuten (#344).
 *
 * Eine Vorbestellung traegt ihre vereinbarte Abholzeit in `scheduledFor`. Beim
 * Konvertieren entsteht daraus eine Order, deren `recordingDate` der
 * **Konvertierungszeitpunkt** ist — nicht die Abholzeit. Bis #344 stand dort fest
 * `estimatedDuration: 0`, und seit #342 druckte der Bon deshalb `SOFORT`, obwohl
 * eine Zeit vereinbart war: Die Kueche bekam die Bestellung als „sofort machen".
 *
 * Abgestimmt (Variante A, 2026-09-20): Die Abholzeit wird als Vorlaufzeit in
 * `estimatedDuration` abgelegt, **nicht** in `targetCompletionAt`. Die Leseseite
 * bleibt damit einquellig — der Bon rechnet unveraendert
 * `recordingDate + estimatedDuration` und trifft wieder `scheduledFor`.
 *
 * 🚫 **Das Feld heisst „geschaetzte Dauer" und traegt hier eine Vorlaufzeit.** Wird
 * eine Bestellung fuer 18:00 schon um 10:00 konvertiert, stehen 480 Minuten darin.
 * Heute liest das nichts als Dauer aus (gemessen in beiden Repos: nur der Bon,
 * dazu `calculateRemainingTime` ohne Ausgabe und das tote `isOverdue`). Sobald
 * eine KDS- oder Auswertungsansicht daran haengt, ist dieser Wert fuer
 * konvertierte Vorbestellungen falsch.
 */

/** Minutenanfang eines Instants — Sekunden und Millisekunden verworfen. */
const floorToMinute = (date: Date): number => Math.floor(date.getTime() / 60_000)

/**
 * Minuten von `convertedAt` bis `scheduledFor`, geklemmt auf `>= 0`.
 *
 * Gerechnet wird auf **Minutenanfaengen**, nicht auf der rohen Differenz. Der
 * Grund steht auf dem Papier: Der Bon formatiert `recordingDate + Minuten` zu
 * `HH:mm`. Eine Konvertierung um 17:45:40 fuer 18:00:00 ergaebe roh 14,33 Minuten
 * — gerundet 14, gedruckt `17:59`. Ueber die Minutenanfaenge sind es 15, gedruckt
 * `18:00`: genau die vereinbarte Zeit. Die Sekunden von `recordingDate` tragen
 * sich dabei mit und heben sich in der Darstellung weg.
 *
 * Eine bereits verstrichene Abholzeit ergibt `0` — der Bon druckt dann `SOFORT`.
 * Das ist die richtige Aussage: Die Bestellung ist faellig, nicht „in −20 Minuten".
 *
 * Ein unbrauchbares `scheduledFor` ergibt ebenfalls `0`. Das Schema verlangt zwar
 * ein `date-time` (`pre-order.schema.ts`), aber die Bestandsdaten liegen in SQLite
 * als String — ein Bon darf daran nicht scheitern.
 */
export function leadMinutesUntil(scheduledFor: string | null | undefined, convertedAt: Date): number {
  if (!scheduledFor) return 0

  const target = new Date(scheduledFor)
  if (Number.isNaN(target.getTime())) return 0

  return Math.max(0, floorToMinute(target) - floorToMinute(convertedAt))
}
