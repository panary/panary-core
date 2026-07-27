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
  /** Adress-Kandidaten, nach Erreichbarkeit vorsortiert (siehe `addressRank`). */
  addresses: string[]
  organizationName?: string
  setupComplete: boolean
  systemMode?: string
  /** HTTP-URL zum Pairing — die erste per `/health` erreichbare Adresse. */
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

/** Probe-Timeout beim Aufloesen mehrdeutiger Hub-Adressen — kurz, laeuft parallel. */
const ADDRESS_PROBE_TIMEOUT_MS = 1500

/**
 * Rang einer Adresse als Hub-Ziel — kleiner ist besser.
 *
 * Ein Hub annonciert alle Adressen seiner Interfaces (LAN, Docker-Bridge, VPN).
 * Die erste aus der mDNS-Antwort ist nicht zwingend die, unter der der POS ihn
 * erreicht — blind zugegriffen landet man leicht auf einer Adresse, die es im
 * LAN des Clients gar nicht gibt. Die Rangfolge sortiert nur vor; entschieden
 * wird per `/health`-Probe in `#resolveReachableUrl`.
 */
function addressRank(ip: string): number {
  if (/^169\.254\./.test(ip)) return 3
  // CGNAT 100.64.0.0/10 — Tailscale & Co.
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return 2
  // 172.16.0.0/12 — Default-Range der Docker-Bridge-Netze.
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1
  return 0
}

/** IPv6-Literale brauchen eckige Klammern in der URL. */
function formatHubUrl(address: string, port: number): string {
  return address.includes(':') ? `http://[${address}]:${port}` : `http://${address}:${port}`
}

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
      const mapped = (raw ?? []).map(r => this.#mapHub(r)).filter((h): h is DiscoveredHub => h !== null)
      // Erst die vorsortierte Auswahl zeigen, damit die Liste sofort steht …
      this.hubs.set(mapped)
      // … dann mehrdeutige Hubs auf die tatsaechlich erreichbare Adresse festnageln.
      const resolved = await Promise.all(mapped.map(h => this.#resolveReachableUrl(h)))
      this.hubs.set(resolved)
      return resolved
    } catch {
      this.hubs.set([])
      return []
    } finally {
      this.scanning.set(false)
    }
  }

  #mapHub(raw: RawDiscoveredHub): DiscoveredHub | null {
    const candidates = this.#rankedAddresses(raw.addresses ?? [])
    const preferred = candidates[0]
    if (!preferred) return null
    const txt = raw.txt ?? {}
    return {
      id: raw.name,
      name: txt['organizationName'] || raw.host || raw.name,
      host: raw.host,
      port: raw.port,
      addresses: candidates,
      organizationName: txt['organizationName'] || undefined,
      setupComplete: txt['setupComplete'] === 'true',
      systemMode: txt['systemMode'] || undefined,
      url: formatHubUrl(preferred, raw.port),
    }
  }

  /** IPv4 zuerst, darin nach `addressRank` sortiert (stabil — mDNS-Reihenfolge bleibt Tiebreak). */
  #rankedAddresses(addresses: string[]): string[] {
    const ipv4 = addresses.filter(a => /^\d+\.\d+\.\d+\.\d+$/.test(a))
    // IPv6 nur als Notnagel: ohne IPv4 waere der Hub sonst gar nicht waehlbar.
    const ordered = ipv4.length > 0 ? ipv4 : addresses
    return [...ordered].sort((a, b) => addressRank(a) - addressRank(b))
  }

  /**
   * Probt die Adress-Kandidaten eines Hubs parallel und uebernimmt die erste
   * erreichbare in Rangfolge.
   *
   * Bleibt alles unerreichbar, behaelt der Hub seine vorsortierte URL und
   * erscheint weiter in der Liste — der Fehler faellt dann beim Pairing auf,
   * statt den Hub stumm verschwinden zu lassen.
   */
  async #resolveReachableUrl(hub: DiscoveredHub): Promise<DiscoveredHub> {
    if (hub.addresses.length < 2) return hub
    const probes = await Promise.all(
      hub.addresses.map(async address => {
        const url = formatHubUrl(address, hub.port)
        const { reachable } = await this.probeHub(url, ADDRESS_PROBE_TIMEOUT_MS)
        return { url, reachable }
      }),
    )
    const firstReachable = probes.find(p => p.reachable)
    return firstReachable ? { ...hub, url: firstReachable.url } : hub
  }

  /**
   * Prüft eine Hub-URL via `/health` — für mDNS-Treffer und für manuell
   * eingegebene IP/URL. Liefert Setup-Status + Betriebsname.
   */
  async probeHub(serverUrl: string, timeoutMs = 5000): Promise<HubProbeResult> {
    const url = serverUrl.replace(/\/$/, '')
    try {
      const res = await fetch(`${url}/health`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(timeoutMs),
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
