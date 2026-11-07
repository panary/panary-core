import { describe, expect, it, onTestFinished, vi } from 'vitest'
import {
  ANDROID_LOG_FILE,
  ANDROID_LOG_MAX_BYTES,
  ANDROID_LOG_READ_CHARS,
  ANDROID_LOG_ROTATED,
  AndroidLogSink,
  formatAndroidLogLine,
  type CapacitorFilesystemLike,
} from './android-log-sink'

/** Dateisystem im Speicher mit dem Verhalten von Android: `appendFile` ohne Elternordner schlägt fehl. */
function fakeFilesystem(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial))
  const dirs = new Set<string>(Object.keys(initial).map(p => p.split('/')[0]))
  const missing = (path: string) => new Error(`File does not exist: ${path}`)
  const fs = {
    files,
    appendFile: vi.fn<CapacitorFilesystemLike['appendFile']>(async ({ path, data }) => {
      if (!dirs.has(path.split('/')[0])) throw new Error('Parent folder does not exist')
      files.set(path, (files.get(path) ?? '') + data)
    }),
    readFile: vi.fn<CapacitorFilesystemLike['readFile']>(async ({ path }) => {
      const data = files.get(path)
      if (data === undefined) throw missing(path)
      return { data }
    }),
    stat: vi.fn<CapacitorFilesystemLike['stat']>(async ({ path }) => {
      const data = files.get(path)
      if (data === undefined) throw missing(path)
      return { size: new TextEncoder().encode(data).length }
    }),
    rename: vi.fn<CapacitorFilesystemLike['rename']>(async ({ from, to }) => {
      const data = files.get(from)
      if (data === undefined) throw missing(from)
      files.set(to, data)
      files.delete(from)
    }),
    deleteFile: vi.fn<CapacitorFilesystemLike['deleteFile']>(async ({ path }) => {
      if (!files.delete(path)) throw missing(path)
    }),
    mkdir: vi.fn<CapacitorFilesystemLike['mkdir']>(async ({ path }) => {
      dirs.add(path)
    }),
    getUri: vi.fn<CapacitorFilesystemLike['getUri']>(async ({ path }) => ({ uri: `file:///data/files/${path}` })),
  }
  return fs
}

const fakeShare = () => ({ share: vi.fn(async () => ({})) })

describe('AndroidLogSink', () => {
  it('legt beim ersten Start den Ordner an und schreibt gesammelte Zeilen in einem Aufruf', async () => {
    const fs = fakeFilesystem()
    const sink = new AndroidLogSink({ filesystem: fs, share: fakeShare() })

    sink.write('eins\n')
    sink.write('zwei\n')
    await sink.flush()

    expect(fs.mkdir).toHaveBeenCalledWith({ path: 'logs', directory: 'DATA', recursive: true })
    expect(fs.appendFile).toHaveBeenCalledTimes(1)
    expect(fs.files.get(ANDROID_LOG_FILE)).toEqual('eins\nzwei\n')
  })

  it('schreibt hinter eine Datei aus der vorigen Sitzung weiter', async () => {
    const fs = fakeFilesystem({ [ANDROID_LOG_FILE]: 'alt\n' })
    const sink = new AndroidLogSink({ filesystem: fs, share: fakeShare() })

    sink.write('neu\n')
    await sink.flush()

    expect(fs.files.get(ANDROID_LOG_FILE)).toEqual('alt\nneu\n')
    expect(fs.mkdir).not.toHaveBeenCalled()
  })

  it('rotiert über 5 MB: alte rotierte Datei weg, aktuelle wird rotiert, neue Zeile in frischer Datei', async () => {
    const voll = 'x'.repeat(ANDROID_LOG_MAX_BYTES - 2)
    const fs = fakeFilesystem({ [ANDROID_LOG_FILE]: voll, [ANDROID_LOG_ROTATED]: 'ganz alt' })
    const sink = new AndroidLogSink({ filesystem: fs, share: fakeShare() })

    sink.write('zu lang\n')
    await sink.flush()

    expect(fs.files.get(ANDROID_LOG_ROTATED)).toEqual(voll)
    expect(fs.files.get(ANDROID_LOG_FILE)).toEqual('zu lang\n')
  })

  it('zählt die geschriebenen Bytes mit und rotiert ohne erneutes stat', async () => {
    const fs = fakeFilesystem({ [ANDROID_LOG_FILE]: 'x'.repeat(ANDROID_LOG_MAX_BYTES - 10) })
    const sink = new AndroidLogSink({ filesystem: fs, share: fakeShare() })

    sink.write('12345\n')
    await sink.flush()
    sink.write('überlauf\n')
    await sink.flush()

    expect(fs.stat).toHaveBeenCalledTimes(1)
    expect(fs.files.get(ANDROID_LOG_FILE)).toEqual('überlauf\n')
    expect(fs.files.get(ANDROID_LOG_ROTATED)).toEqual('x'.repeat(ANDROID_LOG_MAX_BYTES - 10) + '12345\n')
  })

  it('löscht die aktuelle Datei, wenn das Umbenennen scheitert, statt ohne Deckel weiterzuwachsen', async () => {
    const fs = fakeFilesystem({ [ANDROID_LOG_FILE]: 'x'.repeat(ANDROID_LOG_MAX_BYTES) })
    fs.rename.mockRejectedValueOnce(new Error('EBUSY'))
    const sink = new AndroidLogSink({ filesystem: fs, share: fakeShare() })

    sink.write('weiter\n')
    await sink.flush()

    expect(fs.files.get(ANDROID_LOG_FILE)).toEqual('weiter\n')
  })

  it('verschluckt Schreibfehler, ohne die Konsole zu benutzen', async () => {
    const fs = fakeFilesystem({ [ANDROID_LOG_FILE]: '' })
    fs.appendFile.mockRejectedValueOnce(new Error('Speicher voll'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    onTestFinished(() => {
      error.mockRestore()
      warn.mockRestore()
    })
    const sink = new AndroidLogSink({ filesystem: fs, share: fakeShare() })

    sink.write('verloren\n')
    await sink.flush()
    sink.write('danach\n')
    await sink.flush()

    expect(error).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()
    expect(fs.files.get(ANDROID_LOG_FILE)).toEqual('danach\n')
  })

  it('liest nach dem Schreiben das Ende der aktuellen Datei', async () => {
    const fs = fakeFilesystem({ [ANDROID_LOG_FILE]: 'a'.repeat(ANDROID_LOG_READ_CHARS) })
    const sink = new AndroidLogSink({ filesystem: fs, share: fakeShare() })

    sink.write('Ende\n')
    const text = await sink.read()

    expect(text).toHaveLength(ANDROID_LOG_READ_CHARS)
    expect(text.endsWith('aEnde\n')).toBe(true)
  })

  it('liest ohne Datei einen leeren Text', async () => {
    const sink = new AndroidLogSink({ filesystem: fakeFilesystem(), share: fakeShare() })
    expect(await sink.read()).toEqual('')
  })

  it('teilt aktuelle und rotierte Datei als file-URLs', async () => {
    const fs = fakeFilesystem({ [ANDROID_LOG_FILE]: 'neu', [ANDROID_LOG_ROTATED]: 'alt' })
    const share = fakeShare()
    await new AndroidLogSink({ filesystem: fs, share }).share()

    expect(share.share).toHaveBeenCalledWith({
      title: 'Panary POS Log',
      files: ['file:///data/files/logs/panary-pos.log', 'file:///data/files/logs/panary-pos.1.log'],
    })
  })

  it('teilt ohne rotierte Datei nur die aktuelle', async () => {
    const fs = fakeFilesystem({ [ANDROID_LOG_FILE]: 'neu' })
    const share = fakeShare()
    await new AndroidLogSink({ filesystem: fs, share }).share()

    expect(share.share).toHaveBeenCalledWith({
      title: 'Panary POS Log',
      files: ['file:///data/files/logs/panary-pos.log'],
    })
  })

  it('wertet den Abbruch des Teilen-Menüs nicht als Fehler, andere Fehler schon', async () => {
    const fs = fakeFilesystem({ [ANDROID_LOG_FILE]: 'neu' })
    const share = fakeShare()
    const sink = new AndroidLogSink({ filesystem: fs, share })

    share.share.mockRejectedValueOnce(new Error('Share canceled'))
    await expect(sink.share()).resolves.toBeUndefined()

    share.share.mockRejectedValueOnce(new Error('No Activity found'))
    await expect(sink.share()).rejects.toThrow('No Activity found')
  })

  it('meldet einen Fehler, wenn es noch keine Logdatei gibt', async () => {
    const share = fakeShare()
    await expect(new AndroidLogSink({ filesystem: fakeFilesystem(), share }).share()).rejects.toThrow(
      'Keine Logdatei vorhanden',
    )
    expect(share.share).not.toHaveBeenCalled()
  })
})

describe('formatAndroidLogLine', () => {
  it('formatiert wie tauri-plugin-log mit UTC-Zeit', () => {
    expect(formatAndroidLogLine('warn', 'Edge weg', new Date('2026-11-07T21:30:05.123Z'))).toEqual(
      '[2026-11-07][21:30:05.123][webview][WARN] Edge weg\n',
    )
  })
})
