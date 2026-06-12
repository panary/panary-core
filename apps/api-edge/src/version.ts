import { existsSync, readFileSync } from 'fs'
import { dirname, join } from 'path'

const FALLBACK_VERSION = '0.0.0'

/**
 * Sucht von __dirname aufwärts die nächstgelegene package.json mit version-Feld.
 * Deckt beide Laufzeit-Layouts ab:
 *  - Docker/dist: Nx generiert dist/apps/api-edge/package.json (generatePackageJson)
 *  - Workbench/Source: apps/api-edge/package.json (via bump-version.mjs gepflegt)
 */
const readNearestPackageVersion = (): string | undefined => {
  let dir = __dirname
  for (let depth = 0; depth < 8; depth++) {
    const pkgPath = join(dir, 'package.json')
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string }
        if (pkg.version) return pkg.version
      } catch {
        // defekte/fremde package.json — weiter aufwärts suchen
      }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return undefined
}

/**
 * Die App-Version des Edge-Servers (Schema YY.MM.INDEX), einmalig beim Modul-Load aufgelöst.
 *
 * Priorität:
 *  1. PANARY_EDGE_VERSION — wird im Docker-Build aus dem Git-Tag injiziert und
 *     garantiert damit Übereinstimmung mit dem Image-Tag (ghcr.io/panary/panary-edge:<tag>)
 *  2. nächstgelegene package.json — funktioniert ohne npm-Prozess-Env (direkter node-Start)
 *  3. npm_package_version — pnpm/npm-Skript-Kontext als letzter Versuch
 */
export const APP_VERSION: string =
  process.env['PANARY_EDGE_VERSION'] ||
  readNearestPackageVersion() ||
  process.env['npm_package_version'] ||
  FALLBACK_VERSION
