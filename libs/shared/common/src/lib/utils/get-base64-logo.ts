import * as path from 'path'
import * as fs from 'fs'

export function getBase64Logo(): string {
  // Pfad-Logik erklärt:
  // 1. __dirname = .../dist/libs/shared/common/src/lib/utils
  // 2. '..'      = .../dist/libs/shared/common/src/lib
  // 3. '..'      = .../dist/libs/shared/common/src
  // 4. '..'      = .../dist/libs/shared/common  <-- HIER liegt der 'assets' Ordner

  // WICHTIG: Laut deinem Screenshot liegen die Bilder in einem Unterordner 'logos'!
  const logoPath = path.join(__dirname, '..', '..', '..', 'assets', 'logos', 'panary_logo_color.png')

  let base64LogoEncoded = ''

  try {
    if (fs.existsSync(logoPath)) {
      const logoBuffer = fs.readFileSync(logoPath)
      // Wenn es ein PNG ist:
      base64LogoEncoded = `data:image/png;base64,${logoBuffer.toString('base64')}`
    } else {
      // Fehler wird im Log sichtbar, verhindert aber keinen Crash
      console.warn(`Logo file missing at computed path: ${logoPath}`)
    }
  } catch (error) {
    console.error('Error processing logo:', error)
  }

  return base64LogoEncoded
}
