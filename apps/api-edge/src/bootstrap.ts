import path from 'path'
import fs from 'fs'

// Wir definieren mögliche Orte, wo die Config liegen könnte.
// Die Reihenfolge ist wichtig!
const potentialPaths = [
  // 1. Production / Flat Build (Standard im Dist Ordner)
  path.resolve(__dirname, '../config'),

  // 2. Nested Build (Das Problem, das du gerade hast)
  // Wenn TypeScript die Ordnerstruktur im Dist behält
  path.resolve(__dirname, '../../../config'),

  // 3. Development / Local (Nx Serve)
  // process.cwd() ist im Root des Workspaces
  path.resolve(process.cwd(), 'apps/api-edge/config'),

  // 4. Fallback für manuelle Aufrufe
  path.resolve(process.cwd(), 'config')
]

let configDir = ''

// Wir suchen den ersten Pfad, der wirklich existiert
for (const p of potentialPaths) {
  if (fs.existsSync(p) && fs.existsSync(path.join(p, 'default.json'))) {
    configDir = p
    break
  }
}

if (configDir) {
  process.env['NODE_CONFIG_DIR'] = configDir
  console.log('BOOTSTRAP: Config found at:', configDir)
} else {
  console.error('BOOTSTRAP ERROR: No config directory found!')
  console.error('   Checked locations:', potentialPaths)
  // Wir setzen keinen Pfad, damit node-config sein Standardverhalten nutzt (oder crasht)
}
