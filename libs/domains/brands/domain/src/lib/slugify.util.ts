/**
 * Erzeugt einen URL-fähigen Handle (Slug) aus einem Anzeige-Namen.
 *
 * Verwendung: Brand-Handle (`brand.handle`) und Location-Handle
 * (`location.handle`) für Subdomain-Routing (D-14 / BRAND-03):
 * `<location-handle>.<brand-handle>.<panary-tld>`.
 *
 * Regeln:
 * - lowercase
 * - ä→ae, ö→oe, ü→ue, ß→ss vor NFKD-Diakritika-Strip (sonst würde ü→u statt ue)
 * - non-[a-z0-9] → '-'
 * - leading/trailing '-' entfernt
 * - max. 60 Zeichen (passend zum brand.handle-Schema maxLength: 60)
 */
export function slugifyHandle(name: string): string {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
