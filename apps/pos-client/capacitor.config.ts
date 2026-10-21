import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'cloud.panary.pos',
  appName: 'Panary POS',
  webDir: '../../dist/apps/pos-client/browser',
  server: {
    // Origin der WebView = http://localhost. Nur so sind Aufrufe an einen HTTP-Edge im LAN kein Mixed Content.
    androidScheme: 'http',
    cleartext: true,
  },
  plugins: {
    // fetch/XHR laufen über den nativen HTTP-Layer: keine CORS-Prüfung gegen die Cloud-Allowlist.
    CapacitorHttp: { enabled: true },
  },
}

export default config
