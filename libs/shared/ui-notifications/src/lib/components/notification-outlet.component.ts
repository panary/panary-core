import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core'
import { iconPath, type IconName } from '@panary/shared/util-helpers'

import { NotificationService } from '../services/notification.service'
import type { Notification, NotificationType } from '../models/notification.types'
import {
  type LayerPlacement,
  openModalBounds,
  placeBesideDialog,
  raiseAboveForeignPopovers,
  syncTopLayer,
  type TopLayerElement,
} from './top-layer'

/** Höhe einer Meldung, die gerade nicht gezeigt wird (`min-height` 3,5rem). */
const FALLBACK_NOTIFICATION_HEIGHT = 56
/** Abstand zwischen zwei Meldungen (`gap` 0,375rem). */
const NOTIFICATION_GAP = 6
/** Die CDK lässt Dialoge hereinwachsen; nach dieser Zeit steht der Rahmen fest. */
const DIALOG_SETTLE_MS = 250

/**
 * Darf eine Meldung neben einem Dialog zurückgehalten werden? Fehler, Warnungen und Quittierpflichtige nie:
 * Sie stammen oft aus dem Dialog selbst und dürfen nicht ungesehen ablaufen (core#1087).
 */
function holdable(n: Notification): boolean {
  return (n.type === 'success' || n.type === 'info') && n.duration !== 0
}

const ICONS: Record<NotificationType, IconName> = {
  success: 'check-circle',
  info: 'info',
  warning: 'warning',
  error: 'warning-octagon',
}

/**
 * Anzeige der POS-Meldungen (core#1026, Designstudie Variante A).
 *
 * - **Oben mittig im Arbeitsbereich**, unter dem Offline-Streifen: Dort liegen weder Ziffern,
 *   Primärtaste und Dialog-Fußtasten (unten) noch das × eines Dialogs (Ecke). Die Rail-Breite
 *   gleicht `--notification-shift` aus, das der POS je Rail-Seite setzt.
 * - **Über Dialogen**, damit Meldungen aus Abschreiben- oder Bezahl-Dialog sichtbar und antippbar
 *   sind. Die CDK legt Dialoge in den Top-Layer (Popover-API), gegen den kein `z-index` hilft; die
 *   Ebene ist deshalb selbst ein Popover und wird nach jedem neuen Overlay wieder nach oben geholt
 *   (core#1060, `top-layer.ts`).
 * - **Vollton je Art**, damit keine Meldung wie ein Dialog aussieht: Fläche ist die `*-ink`-Farbe
 *   der Art, Schrift die Seitenfläche. In Dunkel kehrt sich das über dieselben Tokens um.
 * - **Ein Tipp schließt**; die Aktionstaste löst ihre Aktion aus. Quittierpflichtige schließen nur
 *   über ×. Solange ein Finger aufliegt, läuft die Zeit nicht ab.
 *
 * Der Host steht in der Spalte des App-Rahmens zwischen Streifen und Inhalt und ist 0 hoch; seine
 * Oberkante liegt genau unter dem Streifen. Die Ebene im Top-Layer übernimmt sie als `top`.
 */
@Component({
  selector: 'lib-notification-outlet',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div #layer class="notification-layer" popover="manual">
      @for (n of notifications(); track n.id; let i = $index) {
        <div
          [class]="'notification notification--' + n.type + (isHeld(n, i) ? ' notification--held' : '')"
          [attr.role]="n.type === 'warning' || n.type === 'error' ? 'alert' : 'status'"
          [attr.data-sticky]="n.duration === 0 ? '' : null"
          tabindex="0"
          (click)="onSurface(n)"
          (keydown.enter)="onSurfaceKey($event, n)"
          (keydown.space)="onSurfaceKey($event, n)"
          (pointerdown)="service.pause(n.id)"
          (pointerup)="service.resume(n.id)"
          (pointercancel)="service.resume(n.id)"
          (pointerleave)="service.resume(n.id)"
        >
          <svg class="notification__icon" viewBox="0 0 256 256" aria-hidden="true" focusable="false">
            <path [attr.d]="icon(n.type)" />
          </svg>
          <p class="notification__text">
            @if (n.title) {
              <strong class="notification__title">{{ n.title }}</strong>
            }
            {{ n.message }}
          </p>
          @if (n.count > 1) {
            <span class="notification__count">×{{ n.count }}</span>
          }
          @if (n.action; as action) {
            <button type="button" class="notification__action" (click)="onAction($event, n)">{{ action.label }}</button>
          }
          @if (n.duration === 0) {
            <button type="button" class="notification__close" aria-label="Schließen" (click)="onClose($event, n)">
              <svg viewBox="0 0 256 256" aria-hidden="true" focusable="false"><path [attr.d]="closeIcon" /></svg>
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      height: 0;
      z-index: 2000;
    }
    .notification-layer {
      position: absolute;
      top: 0.5rem;
      left: calc(50% + var(--notification-shift, 0px));
      transform: translateX(-50%);
      width: min(30rem, calc(100vw - 2rem));
      display: flex;
      flex-direction: column;
      gap: 0.375rem;
      pointer-events: none;
    }
    /* Im Top-Layer: fest am Fenster, die Oberkante setzt syncTopLayer (core#1060). */
    .notification-layer:popover-open {
      position: fixed;
      inset: auto;
      left: calc(50% + var(--notification-shift, 0px));
      margin: 0;
      border: 0;
      padding: 0;
      background: transparent;
      color: inherit;
      overflow: visible;
    }
    .notification {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 0.625rem;
      min-height: 3.5rem;
      padding: 0.25rem 0.25rem 0.25rem 0.875rem;
      border-radius: var(--r-card, 0.75rem);
      box-shadow:
        0 10px 28px rgb(0 0 0 / 0.28),
        0 2px 6px rgb(0 0 0 / 0.18);
      font-family: var(--font-family-sans);
      font-size: var(--font-size-base, 0.875rem);
      font-weight: 600;
      line-height: 1.3;
      color: var(--surface-bg);
      cursor: pointer;
      animation: notification-in 180ms ease-out;
    }
    /* Neben einem offenen Dialog ohne Platz (core#1087): bleibt im Dienst, wird nur nicht gezeigt. */
    .notification--held {
      display: none;
    }
    .notification:focus-visible {
      outline: 3px solid var(--primary);
      outline-offset: 2px;
    }
    .notification--success {
      background: var(--accent-ink);
    }
    .notification--info {
      background: var(--text-primary);
    }
    .notification--warning {
      background: var(--warn-ink);
    }
    .notification--error {
      background: var(--danger-ink);
    }
    .notification__icon {
      flex: none;
      width: 1.25rem;
      height: 1.25rem;
      fill: currentColor;
    }
    .notification__text {
      flex: 1;
      min-width: 0;
      margin: 0;
      white-space: pre-line;
      overflow-wrap: anywhere;
    }
    .notification__title {
      display: block;
    }
    .notification__count {
      flex: none;
      font-family: var(--font-family-mono);
      font-size: var(--font-size-xs, 0.75rem);
      padding: 0.0625rem 0.375rem;
      border-radius: var(--r-pill, 999px);
      background: rgb(0 0 0 / 0.18);
    }
    .notification__action,
    .notification__close {
      flex: none;
      min-height: 3rem;
      border: 0;
      border-radius: var(--r-control, 0.5rem);
      font: inherit;
      font-weight: 700;
      color: inherit;
      cursor: pointer;
    }
    .notification__action {
      padding: 0 0.875rem;
      background: rgb(255 255 255 / 0.18);
      /* Getönt aus der Schriftfarbe: hebt sich hell auf Navy wie dunkel auf Creme ab (core#1060). */
      background: color-mix(in srgb, currentColor 16%, transparent);
    }
    .notification__close {
      width: 3rem;
      display: grid;
      place-items: center;
      background: transparent;
    }
    .notification__close svg {
      width: 1.125rem;
      height: 1.125rem;
      fill: currentColor;
    }
    @keyframes notification-in {
      from {
        transform: translateY(-0.5rem);
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .notification {
        animation: none;
      }
    }
  `,
})
export class NotificationOutletComponent {
  protected readonly service = inject(NotificationService)
  protected readonly notifications = this.service.notifications
  protected readonly closeIcon = iconPath('x')
  readonly #host: ElementRef<HTMLElement> = inject(ElementRef)
  readonly #doc = inject(DOCUMENT)
  private readonly layer = viewChild<ElementRef<HTMLElement>>('layer')
  /** Lage neben einem offenen modalen Dialog (core#1087); `null` = gewohnte Stelle, alle Meldungen. */
  readonly #placement = signal<LayerPlacement | null>(null)
  protected readonly shownCount = computed(() => this.#placement()?.count ?? this.notifications().length)
  /** Zurückgehaltene Meldungen, deren Ablauf hier angehalten wurde — nur die setzt das Outlet fort. */
  readonly #pausedHere = new Set<number>()

  constructor() {
    const anchorTop = (): number => this.#host.nativeElement.getBoundingClientRect().top + 8
    const top = (): number => untracked(this.#placement)?.top ?? anchorTop()
    const visible = (): boolean =>
      untracked(this.notifications).some((n, i) => !this.isHeld(n, i, untracked(this.shownCount)))
    effect(() => {
      this.notifications()
      this.shownCount()
      const layer = this.layer()?.nativeElement as TopLayerElement | undefined
      if (layer) untracked(() => syncTopLayer(layer, visible(), top()))
    })
    // Zurückgehaltene laufen nicht ab: Sie sollen nach dem Dialog noch gelesen werden können.
    effect(() => {
      const shown = this.shownCount()
      const list = this.notifications()
      untracked(() => this.#syncHeldTimers(list, shown))
    })
    // Nach jeder neuen Meldung neu ausrichten: erst gerendert sind die Höhen messbar.
    effect(() => {
      this.notifications()
      untracked(() => this.#doc.defaultView?.requestAnimationFrame(() => this.#place(anchorTop)))
    })
    const destroyRef = inject(DestroyRef)
    afterNextRender(() => {
      const layer = this.layer()?.nativeElement as TopLayerElement | undefined
      if (!layer) return
      const onDialogChange = (): void => {
        this.#place(anchorTop)
        setTimeout(() => this.#place(anchorTop), DIALOG_SETTLE_MS)
      }
      const stop = raiseAboveForeignPopovers(this.#doc, layer, visible, top, onDialogChange)
      destroyRef.onDestroy(stop)
    })
  }

  protected isHeld(n: Notification, index: number, shown = this.shownCount()): boolean {
    return index >= shown && holdable(n)
  }

  #syncHeldTimers(list: readonly Notification[], shown: number): void {
    const held = new Set(list.filter((n, i) => this.isHeld(n, i, shown)).map(n => n.id))
    for (const id of held) {
      if (this.#pausedHere.has(id)) continue
      this.service.pause(id)
      this.#pausedHere.add(id)
    }
    for (const id of this.#pausedHere) {
      if (held.has(id)) continue
      this.#pausedHere.delete(id)
      this.service.resume(id)
    }
  }

  /**
   * Richtet die Ebene am obersten offenen modalen Dialog aus (`placeBesideDialog`). Ohne Popover-API gibt es
   * kein `toggle` beim Schließen des Dialogs — dort wird nicht zurückgehalten, sonst blieben Meldungen
   * bis zur nächsten verborgen.
   */
  #place(anchorTop: () => number): void {
    const layer = this.layer()?.nativeElement
    if (!layer) return
    const items = Array.from(layer.querySelectorAll<HTMLElement>(':scope > .notification'))
    const dialog =
      'showPopover' in layer
        ? openModalBounds(Array.from(this.#doc.querySelectorAll<HTMLElement>('[aria-modal="true"]')))
        : null
    if (!dialog) {
      this.#placement.set(null)
    } else {
      this.#placement.set(
        placeBesideDialog({
          anchorTop: anchorTop(),
          viewportHeight: this.#doc.defaultView?.innerHeight ?? 0,
          dialog,
          heights: items.map(item => item.offsetHeight || FALLBACK_NOTIFICATION_HEIGHT),
          gap: NOTIFICATION_GAP,
        }),
      )
    }
    if ('showPopover' in layer && layer.matches(':popover-open'))
      layer.style.top = `${this.#placement()?.top ?? anchorTop()}px`
  }

  protected icon(type: NotificationType): string {
    return iconPath(ICONS[type])
  }

  /** Tipp auf die Fläche: schließt, außer bei quittierpflichtigen — die schließt nur ×. */
  protected onSurface(n: Notification): void {
    if (n.duration === 0) return
    this.service.remove(n.id)
  }

  /** Tastatur nur auf der Fläche selbst — Enter auf der Aktionstaste soll deren Aktion auslösen. */
  protected onSurfaceKey(event: Event, n: Notification): void {
    if (event.target !== event.currentTarget) return
    event.preventDefault()
    this.onSurface(n)
  }

  protected onAction(event: Event, n: Notification): void {
    event.stopPropagation()
    this.service.runAction(n.id)
  }

  protected onClose(event: Event, n: Notification): void {
    event.stopPropagation()
    this.service.remove(n.id)
  }
}
