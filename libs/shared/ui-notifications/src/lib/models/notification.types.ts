export type NotificationType = 'success' | 'info' | 'warning' | 'error'

/** Eine Taste in der Meldung, z. B. „Rückgängig". Nach dem Tipp schließt die Meldung. */
export type NotificationAction = {
  label: string
  run: () => void
}

export type NotifyOptions = {
  /** Fett vor der Meldung, z. B. „Fehler HTTP-Code 500". */
  title?: string
  action?: NotificationAction
  /**
   * Quittierpflichtig: kein Ablauf, bleibt bis zum Tipp auf ×. Wird beim Stapeln nie
   * verdrängt — so übersieht der Kassierer sie nicht (core#531, core#1026).
   */
  sticky?: boolean
  /** Nur für Sonderfälle; sonst gilt die Dauer der Art ({@link notificationDuration}). */
  duration?: number
}

export type Notification = {
  id: number
  type: NotificationType
  title?: string
  message: string
  action?: NotificationAction
  /** 0 = quittierpflichtig. */
  duration: number
  /** Wie oft dieselbe Meldung kam, solange sie stand. */
  count: number
}

/** Griff auf eine angezeigte Meldung. */
export type NotificationRef = {
  readonly id: number
  dismiss(): void
}
