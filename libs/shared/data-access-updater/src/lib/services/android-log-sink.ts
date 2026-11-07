/**
 * Logdatei des Capacitor-Android-Wrappers (Sunmi), Gegenstück zu `tauri-plugin-log`.
 *
 * Die Lib importiert kein `@capacitor/*`: `apps/pos-client/src/log-capture.ts` reicht die Plugins
 * `Filesystem` und `Share` herein. Die Typen hier sind nur der Ausschnitt, den die Senke benutzt.
 */

/** `Directory.Data` aus `@capacitor/filesystem`: `context.filesDir`, app-privat, übersteht Neustarts. */
const DIRECTORY = 'DATA'
const ENCODING = 'utf8'

export const ANDROID_LOG_DIR = 'logs'
export const ANDROID_LOG_FILE = `${ANDROID_LOG_DIR}/panary-pos.log`
export const ANDROID_LOG_ROTATED = `${ANDROID_LOG_DIR}/panary-pos.1.log`
/** Wie Tauri (`max_file_size(5_000_000)`, `KeepOne`): aktuelle plus eine rotierte Datei, zusammen ~10 MB. */
export const ANDROID_LOG_MAX_BYTES = 5_000_000
/** Wie `read_logs` unter Tauri: die Ansicht zeigt das Ende der aktuellen Datei. */
export const ANDROID_LOG_READ_CHARS = 200 * 1024

type FileOptions = { path: string; directory?: string }

export interface CapacitorFilesystemLike {
  appendFile(options: FileOptions & { data: string; encoding?: string }): Promise<void>
  readFile(options: FileOptions & { encoding?: string }): Promise<{ data: string | Blob }>
  stat(options: FileOptions): Promise<{ size: number }>
  rename(options: { from: string; to: string; directory?: string }): Promise<void>
  deleteFile(options: FileOptions): Promise<void>
  mkdir(options: FileOptions & { recursive?: boolean }): Promise<void>
  getUri(options: { path: string; directory: string }): Promise<{ uri: string }>
}

export interface CapacitorShareLike {
  share(options: { title?: string; files?: string[]; dialogTitle?: string }): Promise<unknown>
}

export interface AndroidLogPlugins {
  filesystem: CapacitorFilesystemLike
  share: CapacitorShareLike
}

const byteLength = (text: string): number => new TextEncoder().encode(text).length

/** `@capacitor/share` lehnt mit dieser Meldung ab, wenn der Nutzer das Teilen-Menü schließt. */
function isShareCanceled(error: unknown): boolean {
  return error instanceof Error && /cancel/i.test(error.message)
}

/**
 * Schreibt Zeilen gepuffert in `logs/panary-pos.log` und rotiert bei 5 MB.
 *
 * Jeder Fehler der Senke wird verschluckt und nie über `console.*` gemeldet: Der Console-Patch würde
 * die Meldung wieder hierher schreiben, und ein dauerhaft defektes Dateisystem liefe im Kreis.
 */
export class AndroidLogSink {
  readonly #fs: CapacitorFilesystemLike
  readonly #share: CapacitorShareLike
  #buffer = ''
  /** Bytes der aktuellen Datei; `null` bis zum ersten `stat`. */
  #size: number | null = null
  #flushing: Promise<void> | null = null

  constructor(plugins: AndroidLogPlugins) {
    this.#fs = plugins.filesystem
    this.#share = plugins.share
  }

  /**
   * Hängt eine Zeile an. Geschrieben wird im nächsten Microtask, alle bis dahin gesammelten Zeilen in
   * einem Aufruf: Ein Bridge-Aufruf je Konsolenzeile wäre teuer, ein Timer verlöre bei einem Kill mehr.
   */
  write(line: string): void {
    this.#buffer += line
    if (!this.#flushing) this.#flushing = Promise.resolve().then(() => this.#drain())
  }

  /** Wartet, bis alles Gepufferte auf der Platte steht. */
  async flush(): Promise<void> {
    while (this.#flushing) await this.#flushing
  }

  async read(): Promise<string> {
    await this.flush()
    try {
      const { data } = await this.#fs.readFile({ path: ANDROID_LOG_FILE, directory: DIRECTORY, encoding: ENCODING })
      const text = typeof data === 'string' ? data : await data.text()
      return text.slice(-ANDROID_LOG_READ_CHARS)
    } catch {
      return ''
    }
  }

  /**
   * Öffnet das Teilen-Menü mit der aktuellen und, falls vorhanden, der rotierten Datei — unter Tauri
   * öffnet „Exportieren" den Ordner und damit ebenfalls beide. Ein Abbruch durch den Nutzer ist kein Fehler.
   */
  async share(): Promise<void> {
    await this.flush()
    const files: string[] = []
    for (const path of [ANDROID_LOG_FILE, ANDROID_LOG_ROTATED]) {
      try {
        await this.#fs.stat({ path, directory: DIRECTORY })
        files.push((await this.#fs.getUri({ path, directory: DIRECTORY })).uri)
      } catch {
        // Datei fehlt: nichts zu teilen.
      }
    }
    if (files.length === 0) throw new Error('Keine Logdatei vorhanden')
    try {
      await this.#share.share({ title: 'Panary POS Log', files })
    } catch (error) {
      if (!isShareCanceled(error)) throw error
    }
  }

  async #drain(): Promise<void> {
    try {
      while (this.#buffer) {
        const chunk = this.#buffer
        this.#buffer = ''
        try {
          await this.#append(chunk)
        } catch {
          // Siehe Klassenkommentar: still verwerfen statt über die Konsole zu melden.
        }
      }
    } finally {
      this.#flushing = null
    }
  }

  async #append(chunk: string): Promise<void> {
    if (this.#size === null) this.#size = await this.#initialSize()
    if (this.#size > 0 && this.#size + byteLength(chunk) > ANDROID_LOG_MAX_BYTES) await this.#rotate()
    await this.#fs.appendFile({ path: ANDROID_LOG_FILE, directory: DIRECTORY, data: chunk, encoding: ENCODING })
    this.#size += byteLength(chunk)
  }

  async #initialSize(): Promise<number> {
    try {
      return (await this.#fs.stat({ path: ANDROID_LOG_FILE, directory: DIRECTORY })).size
    } catch {
      // Erster Start: Ohne Verzeichnis schlägt `appendFile` auf Android fehl.
      await this.#fs.mkdir({ path: ANDROID_LOG_DIR, directory: DIRECTORY, recursive: true }).catch(() => undefined)
      return 0
    }
  }

  async #rotate(): Promise<void> {
    await this.#fs.deleteFile({ path: ANDROID_LOG_ROTATED, directory: DIRECTORY }).catch(() => undefined)
    try {
      await this.#fs.rename({ from: ANDROID_LOG_FILE, to: ANDROID_LOG_ROTATED, directory: DIRECTORY })
    } catch {
      // Lieber die aktuelle Datei verlieren als ohne Deckel weiterwachsen.
      await this.#fs.deleteFile({ path: ANDROID_LOG_FILE, directory: DIRECTORY }).catch(() => undefined)
    }
    this.#size = 0
  }
}

const LEVEL_LABEL: Record<string, string> = { error: 'ERROR', warn: 'WARN', info: 'INFO' }

/** Zeile wie unter Tauri (`[Datum][Zeit][Quelle][LEVEL] Text`), Zeit in UTC. */
export function formatAndroidLogLine(level: string, message: string, now = new Date()): string {
  const [date, time] = now.toISOString().replace('Z', '').split('T')
  return `[${date}][${time}][webview][${LEVEL_LABEL[level] ?? level.toUpperCase()}] ${message}\n`
}
