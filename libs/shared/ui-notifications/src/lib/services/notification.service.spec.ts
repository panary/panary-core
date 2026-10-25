import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MAX_VISIBLE_NOTIFICATIONS, NotificationService, notificationDuration } from './notification.service'

describe('NotificationService (core#1026)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const messages = (service: NotificationService) => service.notifications().map(n => n.message)

  it('legt die neueste Meldung oben ab', () => {
    const service = new NotificationService()
    service.success('erste')
    service.info('zweite')

    expect(messages(service)).toEqual(['zweite', 'erste'])
  })

  it('nimmt die Dauer der Art, mit Aktion steht ein Hinweis länger', () => {
    const service = new NotificationService()
    service.success('a')
    service.info('b')
    service.info('c', { action: { label: 'Rückgängig', run: () => undefined } })
    service.warning('d')
    service.error('e')

    expect(service.notifications().map(n => [n.message, n.duration])).toEqual([
      ['e', 8000],
      ['d', 6000],
      ['c', 6000],
    ])
    expect(notificationDuration('success', false)).toBe(3000)
    expect(notificationDuration('info', false)).toBe(4000)
  })

  it('schließt nach Ablauf der Dauer von selbst', () => {
    const service = new NotificationService()
    service.success('weg')

    vi.advanceTimersByTime(2999)
    expect(messages(service)).toEqual(['weg'])
    vi.advanceTimersByTime(1)
    expect(messages(service)).toEqual([])
  })

  it('quittierpflichtige Meldungen laufen nie ab', () => {
    const service = new NotificationService()
    service.error('Rabattcode nicht eingelöst', { sticky: true })

    vi.advanceTimersByTime(60_000)
    expect(service.notifications()).toEqual([
      expect.objectContaining({ message: 'Rabattcode nicht eingelöst', duration: 0 }),
    ])
  })

  it(`zeigt höchstens ${MAX_VISIBLE_NOTIFICATIONS} und verdrängt die älteste mit Ablauf, nie eine quittierpflichtige`, () => {
    const service = new NotificationService()
    service.error('quittieren', { sticky: true })
    service.success('eins')
    service.success('zwei')
    service.success('drei')

    expect(messages(service)).toEqual(['drei', 'zwei', 'quittieren'])
  })

  it('verdrängt nichts, wenn nur quittierpflichtige stehen', () => {
    const service = new NotificationService()
    for (const m of ['a', 'b', 'c', 'd']) service.error(m, { sticky: true })

    expect(messages(service)).toEqual(['d', 'c', 'b', 'a'])
  })

  it('zählt dieselbe Meldung hoch und startet ihren Ablauf neu', () => {
    const service = new NotificationService()
    service.success('gespeichert')
    vi.advanceTimersByTime(2000)
    service.success('gespeichert')

    expect(service.notifications()).toEqual([expect.objectContaining({ message: 'gespeichert', count: 2 })])
    vi.advanceTimersByTime(2000)
    expect(messages(service)).toEqual(['gespeichert'])
    vi.advanceTimersByTime(1000)
    expect(messages(service)).toEqual([])
  })

  it('unterscheidet gleiche Texte verschiedener Art', () => {
    const service = new NotificationService()
    service.info('x')
    service.error('x')

    expect(service.notifications().map(n => n.type)).toEqual(['error', 'info'])
  })

  it('runAction führt die Aktion aus und schließt die Meldung', () => {
    const service = new NotificationService()
    const run = vi.fn()
    const ref = service.info('entfernt', { action: { label: 'Rückgängig', run } })

    service.runAction(ref.id)

    expect(run).toHaveBeenCalledTimes(1)
    expect(messages(service)).toEqual([])
    service.runAction(ref.id)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('dismiss über den Griff schließt nur die eigene Meldung', () => {
    const service = new NotificationService()
    const ref = service.info('eins')
    service.info('zwei')

    ref.dismiss()

    expect(messages(service)).toEqual(['zwei'])
  })

  it('pause hält den Ablauf an, resume läuft mit der Restzeit weiter', () => {
    const service = new NotificationService()
    const ref = service.success('halten')
    vi.advanceTimersByTime(1000)

    service.pause(ref.id)
    vi.advanceTimersByTime(10_000)
    expect(messages(service)).toEqual(['halten'])

    service.resume(ref.id)
    vi.advanceTimersByTime(1999)
    expect(messages(service)).toEqual(['halten'])
    vi.advanceTimersByTime(1)
    expect(messages(service)).toEqual([])
  })

  it('ein verdrängter Timer schließt später keine andere Meldung', () => {
    const service = new NotificationService()
    const removed = vi.spyOn(service, 'remove')
    service.success('alt')
    service.error('a', { sticky: true })
    service.error('b', { sticky: true })
    service.error('c', { sticky: true })
    removed.mockClear()

    vi.advanceTimersByTime(10_000)

    expect(removed).not.toHaveBeenCalled()
    expect(messages(service)).toEqual(['c', 'b', 'a'])
  })
})
