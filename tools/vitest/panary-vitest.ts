import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Plugin } from 'vite'

const workspaceRoot = join(__dirname, '../..')

/**
 * Gemeinsame Vitest-Plugins fuer Libs mit `paths`-Override auf ein fremdes dist
 * (CLAUDE.md §2.1). Einbindung per RELATIVEM Pfad aus der `vitest.config.mts` der Lib —
 * kein `@panary/*`-Import, der waere dieselbe Falle:
 *
 *   import { panaryVitestPlugins } from '../../../../tools/vitest/panary-vitest'
 *   plugins: [...panaryVitestPlugins(), nxViteTsPaths(), nxCopyAssetsPlugin(['*.md'])],
 *
 * 🚨 Die Plugins MUESSEN vor `nxViteTsPaths()` stehen; innerhalb von `enforce: 'pre'` gilt
 * die Array-Reihenfolge.
 * 🚨 Der Einbau gehoert in `vitest.config.mts`, nicht in `vite.config.ts`: Vitest sucht
 * `vitest.config.*` zuerst, ein Fix in `vite.config.ts` wirkt dann nie und nichts meldet es
 * (panary/panary-core#334).
 */

/**
 * Biegt JEDEN `@panary/*`-Import fuer die Vitest-LAUFZEIT auf die TS-Quelle aus
 * `tsconfig.base.json` um.
 *
 * Die `paths`-Overrides in `tsconfig.lib.json` zeigen auf dist-`.d.ts` (Build-Typ-
 * Aufloesung, sonst TS6059). `nxViteTsPaths()` liest genau diese `paths`; sobald das dist
 * der Ziel-Lib liegt, laedt Vitest darueber eine reine TYPdatei ohne Code: der Export ist
 * `undefined` (#225 „Class extends value undefined", #334, #393). Ohne dist faellt das
 * Plugin auf `tsconfig.base.json` zurueck — ob ein dist liegt, entscheidet die
 * Task-Reihenfolge (`test` hat kein `dependsOn`, #398). Dieser Resolver macht das Ergebnis
 * davon unabhaengig.
 *
 * Generisch statt handgepflegter Liste: Der Override gilt fuer alle Module im Testlauf,
 * auch fuer Quellen fremder Libs; eine Liste deckt nur ab, was jemand bedacht hat (#403).
 *
 * Ein Resolver statt `resolve.alias`, weil er exakt vergleicht: Der Alias faengt auch
 * Unterpfade (`@panary/shared/data-access` → `…/server`, ENOTDIR — #402).
 */
export const panarySourcesForVitest = (): Plugin => {
  const basePaths = (
    JSON.parse(readFileSync(join(workspaceRoot, 'tsconfig.base.json'), 'utf-8')) as {
      compilerOptions: { paths: Record<string, string[]> }
    }
  ).compilerOptions.paths
  const sources: Record<string, string> = Object.fromEntries(
    Object.entries(basePaths)
      .filter(([importPath]) => importPath.startsWith('@panary/'))
      .map(([importPath, [target]]) => [importPath, join(workspaceRoot, target)]),
  )
  return {
    name: 'panary-sources-for-vitest',
    enforce: 'pre',
    resolveId: (id: string) => sources[id] ?? null,
  }
}

/**
 * Bricht den Testlauf hart ab, sobald zur Laufzeit eine Typdatei (`.d.ts`) geladen wird.
 *
 * Einen legitimen Laufzeit-Import einer `.d.ts` gibt es nicht: Sie enthaelt keinen Code,
 * jeder gesuchte Export ist `undefined`, und ein Fehler entsteht nur dort, wo er beim
 * Laden benutzt wird — sonst bleibt der Lauf still gruen. Geprueft wird im `load`-Hook,
 * nicht in `resolveId`: Vites Alias laeuft vor allen `enforce: 'pre'`-Plugins und schreibt
 * Schluessel um, bevor ein Plugin sie sieht; `load` sieht jede geladene Datei.
 */
export const forbidDeclarationLoads = (): Plugin => {
  // Vites ModuleInfo kennt `importers` nicht — den Importeur merkt sich deshalb der Resolver-Hook.
  const importerOf = new Map<string, string>()
  return {
    name: 'panary-forbid-declaration-loads',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      if (!importer) return null
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (resolved && !importerOf.has(resolved.id)) importerOf.set(resolved.id, importer)
      return resolved
    },
    load(id: string) {
      const file = id.split('?')[0]
      if (!/\.d\.[cm]?ts$/.test(file)) return null
      throw new Error(
        `Vitest laedt zur Laufzeit eine Typdatei: ${file}\n` +
          `  Importeur: ${importerOf.get(id) ?? '(unbekannt)'}\n` +
          '  Eine .d.ts enthaelt keinen Code — jeder Export daraus ist undefined. Ursache ist ein\n' +
          '  paths-Override auf ein fremdes dist in der tsconfig.lib.json der Lib, den die\n' +
          '  vitest.config.mts nicht auf die Quelle umbiegt. Einbau: tools/vitest/panary-vitest.ts,\n' +
          '  Regel: CLAUDE.md §2.1 (Cross-Lib-Imports).',
      )
    },
  }
}

/** Resolver + Waechter in der Reihenfolge, die traegt (Resolver zuerst). */
export const panaryVitestPlugins = (): Plugin[] => [panarySourcesForVitest(), forbidDeclarationLoads()]
