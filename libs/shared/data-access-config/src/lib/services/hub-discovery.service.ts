import { Injectable, signal } from '@angular/core'

/**
 * Ein im LAN gefundener Panary-Hub (Edge-Server), aufbereitet für die Anzeige
 * in der Setup-Wizard-Liste.
 */
export interface DiscoveredHub {
  /** mDNS-Fullname — stabiler Tracking-Key für @for. */
  id: string
  /** Anzeigename: organizationName aus TXT, sonst Hostname. */
  name: string
  host: string
  port: number
  addresses: string[]
  organizationName?: string
  setupComplete: boolean
  systemMode?: string
  /** Bevorzugte HTTP-URL zum Pairing (erste IPv4-Adresse). */
  url: string
}

/** Ergebnis eines /health-Probes (auch für manuell eingegebene Hub-URLs). */
export interface HubProbeResult {
  reachable: boolean
  organizationName?: string
  setupComplete?: boolean
  systemMode?: string
  version?: string
}

/** Roh-Struktur, wie sie der Tauri-Command `discover_panary_hubs` liefert. */
interface RawDiscoveredHub {
  name: string
  host: string
  port: number
  addresses: string[]
  txt: Record<string, string>
}

type TauriInvoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>

/**
 * Findet Panary-Hubs im lokalen Netzwerk.
 *
 * mDNS-Browsing erfordert nativen Code und läuft daher im Tauri-Rust-Layer
 * (`discover_panary_hubs`), angesprochen über das globale `window.__TAURI__`
 * (aktiviert via `withGlobalTauri` in tauri.conf.json). Im Browser-Dev oder
 * wenn Multicast im Netz blockiert ist, liefert die Suche eine leere Liste —
 * QR-Scan und manuelle IP-Eingabe bleiben als Fallback nutzbar.
 */
@Injectable({ providedIn: 'root' })
export class HubDiscoveryService {
  readonly isTauri = signal<boolean>(this.#detectTauri())
  readonly scanning = signal<boolean>(false)
  readonly hubs = signal<DiscoveredHub[]>([])

  #detectTauri(): boolean {
    return typeof window !== 'undefined' && !!this.#getInvoke()
  }

  #getInvoke(): TauriInvoke | null {
    const w = window as unknown as { __TAURI__?: { core?: { invoke?: TauriInvoke } } }
    return w?.__TAURI__?.core?.invoke ?? null
  }

  /**
   * Sucht per mDNS nach Panary-Hubs (`_panary._tcp`). Aktualisiert das `hubs`-
   * und `scanning`-Signal und gibt die Liste zusätzlich zurück.
   */
  async discoverHubs(timeoutMs = 2500): Promise<DiscoveredHub[]> {
    const invoke = this.#getInvoke()
    if (!invoke) {
      this.hubs.set([])
      return []
    }
    this.scanning.set(true)
    try {
      const raw = (await invoke('discover_panary_hubs', { timeoutMs })) as RawDiscoveredHub[]
      const mapped = (raw ?? [])
        .map(r => this.#mapHub(r))
        .filter((h): h is DiscoveredHub => h !== null)
      this.hubs.set(mapped)
      return mapped
    } catch {
      this.hubs.set([])
      return []
    } finally {
      this.scanning.set(false)
    }
  }

  #mapHub(raw: RawDiscoveredHub): DiscoveredHub | null {
    const ipv4 = raw.addresses?.find(a => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? raw.addresses?.[0]
    if (!ipv4) return null
    const txt = raw.txt ?? {}
    return {
      id: raw.name,
      name: txt['organizationName'] || raw.host || raw.name,
      host: raw.host,
      port: raw.port,
      addresses: raw.addresses,
      organizationName: txt['organizationName'] || undefined,
      setupComplete: txt['setupComplete'] === 'true',
      systemMode: txt['systemMode'] || undefined,
      url: `http://${ipv4}:${raw.port}`,
    }
  }

  /**
   * Prüft eine Hub-URL via `/health` — für mDNS-Treffer und für manuell
   * eingegebene IP/URL. Liefert Setup-Status + Betriebsname.
   */
  async probeHub(serverUrl: string): Promise<HubProbeResult> {
    const url = serverUrl.replace(/\/$/, '')
    try {
      const res = await fetch(`${url}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) return { reachable: false }
      const data = (await res.json()) as Record<string, unknown>
      return {
        reachable: true,
        organizationName: data['organizationName'] as string | undefined,
        setupComplete: data['setupComplete'] as boolean | undefined,
        systemMode: data['systemMode'] as string | undefined,
        version: data['version'] as string | undefined,
      }
    } catch {
      return { reachable: false }
    }
  }
}
