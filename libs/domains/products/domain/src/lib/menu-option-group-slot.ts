/**
 * Platz, in dem die Kasse die Wahl einer Auswahlgruppe bucht: `side` (Beilage), `drink` (Getränk) oder `null`
 * für alles andere, das als Modifier läuft (Soßen, Extras). Die Zuordnung hängt allein am Gruppennamen.
 *
 * Bildet `selectOptionGroupItem` der Kasse exakt nach: `beilage`/`side` und `getränk`/`drink`, ohne `getraenk`.
 * `roleFromGroupName` erkennt zusätzlich `getraenk`; die beiden anzugleichen würde Gruppen vom Extra in den
 * Getränke-Platz verschieben und ist eine eigene Entscheidung (core#1455).
 */
export type MenuOptionGroupSlot = 'side' | 'drink'

export function menuOptionGroupSlot(groupName: string | null | undefined): MenuOptionGroupSlot | null {
  const name = (groupName || '').toLowerCase()
  if (name.includes('beilage') || name.includes('side')) return 'side'
  if (name.includes('getränk') || name.includes('drink')) return 'drink'
  return null
}
