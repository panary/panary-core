import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (file: string) => readFileSync(join(__dirname, '..', file), 'utf8')
const tokensCss = read('tokens.css')
const themeCss = read('theme.css')

/** Deklarationen `--name: wert` eines Blocks, dessen Kopf mit `selector {` beginnt. */
function declarations(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`)
  if (start < 0) throw new Error(`Block nicht gefunden: ${selector}`)
  const body = css.slice(css.indexOf('{', start) + 1, css.indexOf('}', start))
  const out: Record<string, string> = {}
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim()
  return out
}

const light = declarations(tokensCss, ':root')
const dark = declarations(tokensCss, ":root[data-theme='dark']")
const darkMedia = declarations(tokensCss, ":root:not([data-theme='light'])")

/** Zusammengesetzte Werte: im dunklen Block gesetzte Token ueberschreiben die hellen. */
const theme = (overrides: Record<string, string>) => ({ ...light, ...overrides })
const themes = { hell: light, dunkel: theme(dark) }

function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(0) + 0.7152 * channel(1) + 0.0722 * channel(2)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** [Vordergrund, Hintergrund, Mindestkontrast (WCAG 2.2: Text 4,5 / grosse Schrift und Bedienelemente 3)] */
const pairs: [string, string, number][] = [
  ['--text-primary', '--surface-bg', 4.5],
  ['--text-primary', '--surface-panel', 4.5],
  ['--text-primary', '--surface-panel-elevated', 4.5],
  ['--text-primary', '--surface-rail', 4.5],
  ['--text-primary', '--pos-key', 4.5],
  ['--text-muted', '--surface-bg', 4.5],
  ['--text-muted', '--surface-panel', 4.5],
  ['--text-muted', '--pos-key', 4.5],
  ['--text-faint', '--surface-panel', 3],
  ['--on-primary', '--primary', 4.5],
  ['--accent-ink', '--surface-panel', 4.5],
  ['--accent-ink', '--surface-bg', 4.5],
  ['--accent-ink', '--accent-soft', 4.5],
  ['--danger-ink', '--surface-panel', 4.5],
  ['--danger-ink', '--danger-soft', 4.5],
  ['--warn-ink', '--surface-panel', 4.5],
  ['--warn-ink', '--warn-soft', 4.5],
  ['--info-ink', '--surface-panel', 4.5],
  ['--info-ink', '--info-soft', 4.5],
  ['--pos-key-line', '--surface-bg', 1.2],
]

describe('design-tokens: Kontrast', () => {
  describe.each(Object.entries(themes))('Warm %s', (_name, t) => {
    it.each(pairs)('%s auf %s >= %s:1', (fg, bg, min) => {
      expect(t[fg], `${fg} fehlt`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(t[bg], `${bg} fehlt`).toMatch(/^#[0-9a-f]{6}$/i)
      expect(contrast(t[fg], t[bg])).toBeGreaterThanOrEqual(min)
    })
  })
})

describe('design-tokens: Aufbau', () => {
  it('Dunkel-Block und prefers-color-scheme-Block sind inhaltsgleich', () => {
    expect(darkMedia).toEqual(dark)
  })

  it('jedes Token des Dunkel-Blocks existiert auch im hellen Block', () => {
    expect(Object.keys(dark).filter(k => !(k in light))).toEqual([])
  })

  it('traegt keine Storefront-Tokens (--st-*)', () => {
    expect(tokensCss + themeCss).not.toMatch(/^\s*--st-[\w-]+\s*:/m)
  })

  it('Touch-Skala waechst: min < Standard < Primaer, alle in rem', () => {
    const rem = (k: string) => parseFloat(light[k])
    expect(light['--touch-min']).toMatch(/rem$/)
    expect(rem('--touch-min')).toBe(3)
    expect(rem('--touch')).toBe(3.5)
    expect(rem('--touch-primary')).toBe(4)
  })

  it('Schriftgroessen sind rem (skalieren mit der Wurzelschrift)', () => {
    const sizes = Object.entries(light).filter(([k]) => k.startsWith('--font-size-'))
    expect(sizes.length).toBeGreaterThan(0)
    for (const [, v] of sizes) expect(v).toMatch(/^[\d.]+rem$/)
  })

  it('theme.css verweist nur auf Token, die tokens.css definiert, und nie auf sich selbst', () => {
    const defined = new Set(Object.keys(light))
    const mapped = [...themeCss.matchAll(/(--[\w-]+)\s*:\s*var\((--[\w-]+)\)/g)]
    expect(mapped.length).toBeGreaterThan(0)
    for (const [, name, source] of mapped) {
      expect(defined.has(source), `${name} -> ${source} nicht in tokens.css`).toBe(true)
      expect(name).not.toBe(source)
    }
  })
})

describe('design-tokens: Schriften und Palette', () => {
  const fontsCss = read('fonts.css')

  it('jede woff2-Datei aus fonts.css existiert im Paket', () => {
    const urls = [...fontsCss.matchAll(/url\('\.\/([^']+)'\)/g)].map(m => m[1])
    expect(urls.length).toBeGreaterThan(0)
    expect(urls.filter(u => !existsSync(join(__dirname, '..', u)))).toEqual([])
  })

  it('legacy-palette: gray und slate sind gleich, warm und werden von hell nach dunkel dunkler', () => {
    const legacy = read('legacy-palette.css')
    const ramp = (name: string) =>
      [...legacy.matchAll(new RegExp(`--color-${name}-(\\d+): (#[0-9a-f]{6});`, 'g'))]
        .map(m => [Number(m[1]), m[2]] as const)
        .sort((a, b) => a[0] - b[0])
    const gray = ramp('gray')
    expect(gray.length).toBe(12)
    expect(ramp('slate')).toEqual(gray)
    const lum = gray.map(([, hex]) => luminance(hex))
    expect([...lum].sort((a, b) => b - a)).toEqual(lum)
    // kein reines Schwarz/Weiss: dunkelste Stufe bleibt warm
    expect(gray[gray.length - 1][1]).not.toBe('#000000')
  })

  it('legacy-palette: dunkle Stufen decken sich mit den dunklen Flaechen-Tokens', () => {
    const legacy = read('legacy-palette.css')
    expect(legacy).toContain(`--color-gray-900: ${dark['--surface-bg']}`)
    expect(legacy).toContain(`--color-gray-850: ${dark['--surface-panel']}`)
    expect(legacy).toContain(`--color-gray-800: ${dark['--surface-panel-elevated']}`)
  })
})
