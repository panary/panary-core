// Mengenangabe vor einer Positions- oder Modifier-Zeile (#1257).
//
// Menge 1 ist der Normalfall und traegt keine Angabe — ein `1x` vor jeder Zeile
// verlaengert den Bon, ohne der Kueche etwas zu sagen. Dieselbe Regel gilt im
// Bestelldialog seit #795 (`@if (lineItem.amount > 1)`); Bon und POS-Ansichten
// ziehen hier nach, damit der Ausdruck nicht anders liest als der Bildschirm.
export function amountPrefix(amount: number): string {
  return amount > 1 ? `${amount}x ` : ''
}
