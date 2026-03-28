import { computed, Injectable, signal } from '@angular/core'

export interface UpdateInfo {
  version: string
  date?: string
  body?: string
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

@Injectable({ providedIn: 'root' })
export class UpdateService {
  readonly updateAvailable = signal<UpdateInfo | null>(null)
  readonly hasUpdate = computed(() => this.updateAvailable() !== null)
  readonly isChecking = signal(false)
  readonly isDownloading = signal(false)
  readonly downloadProgress = signal(0)

  private checkInterval: ReturnType<typeof setInterval> | null = null

  startPeriodicCheck(intervalMs = 30 * 60 * 1000): void {
    if (!isTauri()) return

    // Erster Check nach 5 Sekunden
    setTimeout(() => this.checkForUpdate(), 5000)

    this.checkInterval = setInterval(() => this.checkForUpdate(), intervalMs)
  }

  stopPeriodicCheck(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
  }

  async checkForUpdate(): Promise<void> {
    if (!isTauri() || this.isChecking()) return

    this.isChecking.set(true)

    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()

      if (update) {
        this.updateAvailable.set({
          version: update.version,
          date: update.date,
          body: update.body ?? undefined,
        })
      }
    } catch (error) {
      console.error('Update-Prüfung fehlgeschlagen:', error)
    } finally {
      this.isChecking.set(false)
    }
  }

  async downloadAndInstall(): Promise<void> {
    if (!isTauri() || this.isDownloading()) return

    this.isDownloading.set(true)
    this.downloadProgress.set(0)

    try {
      const { check } = await import('@tauri-apps/plugin-updater')
      const update = await check()

      if (!update) {
        this.isDownloading.set(false)
        return
      }

      let totalLength = 0
      let downloaded = 0

      await update.downloadAndInstall(event => {
        switch (event.event) {
          case 'Started':
            totalLength = event.data.contentLength ?? 0
            break
          case 'Progress':
            downloaded += event.data.chunkLength
            if (totalLength > 0) {
              this.downloadProgress.set(Math.round((downloaded / totalLength) * 100))
            }
            break
          case 'Finished':
            this.downloadProgress.set(100)
            break
        }
      })

      // Neustart auslösen
      const { relaunch } = await import('@tauri-apps/plugin-process')
      await relaunch()
    } catch (error) {
      console.error('Update-Installation fehlgeschlagen:', error)
      this.isDownloading.set(false)
      this.downloadProgress.set(0)
    }
  }
}
