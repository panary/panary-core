import { Injectable, Signal, signal } from '@angular/core'
import type { Notification, NotificationRef, NotificationType, NotifyOptions } from '../models/notification.types'

/** Höchstens so viele Meldungen stehen untereinander (Designstudie core#1026). */
export const MAX_VISIBLE_NOTIFICATIONS = 3

/**
 * Anzeigedauer je Art in ms. Eine Meldung mit Aktion steht länger, damit die Taste
 * noch erreichbar ist, nachdem man sie gelesen hat. Seit core#1065 deutlich länger als zuvor
 * (3/4/6/8 s): Eine Erstnutzerin konnte die Meldungen auf der Sunmi-Kasse nicht zu Ende lesen.
 */
export function notificationDuration(type: NotificationType, hasAction: boolean): number {
  switch (type) {
    case 'success':
      return 5000
    case 'info':
      return hasAction ? 9000 : 7000
    case 'warning':
      return 9000
    case 'error':
      return 12000
  }
}

type Timer = { handle: ReturnType<typeof setTimeout> | null; remaining: number; startedAt: number }

/**
 * Die eine Meldungsquelle des POS (core#1026), ersetzt `MatSnackBar`.
 *
 * Regeln:
 * - Bis zu {@link MAX_VISIBLE_NOTIFICATIONS} stehen gleichzeitig, die neueste oben. Eine weitere
 *   verdrängt die älteste mit Ablauf; quittierpflichtige (`sticky`) verdrängt nichts.
 * - Dieselbe Meldung (Art, Titel, Text) erscheint nicht doppelt: Sie zählt hoch, ihr Ablauf
 *   beginnt neu.
 * - Der Ablauf liegt hier, nicht in der Anzeige: Er ist ohne DOM prüfbar, und `pause()` hält
 *   ihn an, solange ein Finger auf der Meldung liegt.
 */
@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  #notifications = signal<Notification[]>([])
  #timers = new Map<number, Timer>()
  #idCounter = 0

  get notifications(): Signal<Notification[]> {
    return this.#notifications.asReadonly()
  }

  success(message: string, options?: NotifyOptions): NotificationRef {
    return this.notify('success', message, options)
  }

  info(message: string, options?: NotifyOptions): NotificationRef {
    return this.notify('info', message, options)
  }

  warning(message: string, options?: NotifyOptions): NotificationRef {
    return this.notify('warning', message, options)
  }

  error(message: string, options?: NotifyOptions): NotificationRef {
    return this.notify('error', message, options)
  }

  notify(type: NotificationType, message: string, options: NotifyOptions = {}): NotificationRef {
    const duration = options.sticky ? 0 : (options.duration ?? notificationDuration(type, !!options.action))
    const same = this.#notifications().find(n => n.type === type && n.message === message && n.title === options.title)
    if (same) {
      // Quittierpflicht gewinnt: Eine Wiederholung ohne `sticky` darf eine stehende Meldung nicht
      // zeitgesteuert machen. Eine Aktion bleibt, wenn die Wiederholung keine mitbringt.
      const updated: Notification = {
        ...same,
        count: same.count + 1,
        action: options.action ?? same.action,
        duration: same.duration === 0 ? 0 : duration,
      }
      this.#notifications.update(list => list.map(n => (n.id === same.id ? updated : n)))
      this.#arm(updated)
      return this.#ref(same.id)
    }

    const created: Notification = {
      id: ++this.#idCounter,
      type,
      title: options.title,
      message,
      action: options.action,
      duration,
      count: 1,
    }
    this.#notifications.update(list => [created, ...list])
    this.#trim(created.id)
    this.#arm(created)
    return this.#ref(created.id)
  }

  /** Schließt eine Meldung. Unbekannte IDs sind ein No-Op. */
  remove(id: number): void {
    this.#clearTimer(id)
    this.#notifications.update(list => list.filter(n => n.id !== id))
  }

  /** Führt die Aktion einer Meldung aus und schließt sie. */
  runAction(id: number): void {
    const notification = this.#notifications().find(n => n.id === id)
    if (!notification) return
    this.remove(id)
    notification.action?.run()
  }

  /** Hält den Ablauf an (Finger liegt auf der Meldung). */
  pause(id: number): void {
    const timer = this.#timers.get(id)
    if (!timer?.handle) return
    clearTimeout(timer.handle)
    timer.handle = null
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt))
  }

  /** Setzt einen angehaltenen Ablauf mit der Restzeit fort. */
  resume(id: number): void {
    const timer = this.#timers.get(id)
    if (!timer || timer.handle) return
    this.#start(id, timer)
  }

  #ref(id: number): NotificationRef {
    return { id, dismiss: () => this.remove(id) }
  }

  #arm(notification: Notification): void {
    // Liegt gerade ein Finger auf der Meldung, bleibt sie angehalten; nur die Restzeit beginnt neu.
    const paused = this.#timers.get(notification.id)?.handle === null
    this.#clearTimer(notification.id)
    if (notification.duration <= 0) return
    const timer: Timer = { handle: null, remaining: notification.duration, startedAt: 0 }
    this.#timers.set(notification.id, timer)
    if (!paused) this.#start(notification.id, timer)
  }

  #start(id: number, timer: Timer): void {
    timer.startedAt = Date.now()
    timer.handle = setTimeout(() => this.remove(id), timer.remaining)
  }

  #clearTimer(id: number): void {
    const timer = this.#timers.get(id)
    if (timer?.handle) clearTimeout(timer.handle)
    this.#timers.delete(id)
  }

  /**
   * Verdrängt die ältesten Meldungen mit Ablauf, bis der Stapel wieder passt. Die gerade angelegte
   * nie: Stehen schon genug quittierpflichtige, wächst der Stapel, statt die neue still zu schlucken.
   */
  #trim(createdId: number): void {
    let list = this.#notifications()
    while (list.length > MAX_VISIBLE_NOTIFICATIONS) {
      const oldest = [...list].reverse().find(n => n.duration > 0 && n.id !== createdId)
      if (!oldest) break
      this.#clearTimer(oldest.id)
      list = list.filter(n => n !== oldest)
    }
    this.#notifications.set(list)
  }
}
