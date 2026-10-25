import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  DOCUMENT,
  effect,
  ElementRef,
  inject,
  untracked,
  viewChild,
} from '@angular/core'
import { iconPath, type IconName } from '@panary/shared/util-helpers'

import { NotificationService } from '../services/notification.service'
import type { Notification, NotificationType } from '../models/notification.types'
import { raiseAboveForeignPopovers, syncTopLayer, type TopLayerElement } from './top-layer'

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
      @for (n of notifications(); track n.id) {
        <div
          [class]="'notification notification--' + n.type"
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
  private readonly layer = viewChild<ElementRef<HTMLElement>>('layer')

  constructor() {
    const top = (): number => this.#host.nativeElement.getBoundingClientRect().top + 8
    effect(() => {
      const visible = this.notifications().length > 0
      const layer = this.layer()?.nativeElement as TopLayerElement | undefined
      if (layer) untracked(() => syncTopLayer(layer, visible, top()))
    })
    const doc = inject(DOCUMENT)
    const destroyRef = inject(DestroyRef)
    afterNextRender(() => {
      const layer = this.layer()?.nativeElement as TopLayerElement | undefined
      if (!layer) return
      const stop = raiseAboveForeignPopovers(doc, layer, () => untracked(this.notifications).length > 0, top)
      destroyRef.onDestroy(stop)
    })
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
