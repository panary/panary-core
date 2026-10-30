// Zeichenfilter und Seitenaufteilung des Firmenkunden-Panels im Bestelldialog (core#1224).

/** Anfangsbuchstabe A–Z eines Namens; Umlaute und Akzente fallen auf den Grundbuchstaben, sonst `#`. */
export function customerInitial(name: string): string {
  const first = name.trim().normalize('NFD').charAt(0).toUpperCase()
  return /^[A-Z]$/.test(first) ? first : '#'
}

export function filterByInitial<T extends { name1: string }>(customers: T[], character: string | null): T[] {
  if (!character) return customers
  return customers.filter(c => customerInitial(c.name1) === character)
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize))
}

export function pageSlice<T>(items: T[], page: number, pageSize: number): T[] {
  return items.slice(page * pageSize, (page + 1) * pageSize)
}
