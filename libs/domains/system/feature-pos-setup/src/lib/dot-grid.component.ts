import { Component, ElementRef, OnDestroy, viewChild, afterNextRender } from '@angular/core'

interface DotState {
  /** Aktueller interpolierter Wert 0–1 (0 = Ruhe, 1 = voll aktiv) */
  activation: number
}

/** Farbwerte für Dark- und Light-Modus */
interface ThemeColors {
  restR: number
  restG: number
  restB: number
  aquaR: number
  aquaG: number
  aquaB: number
  restOpacity: number
  activeOpacity: number
  lineOpacity: number
}

const DARK_COLORS: ThemeColors = {
  restR: 100, restG: 116, restB: 139,   // Slate-500
  aquaR: 0, aquaG: 184, aquaB: 212,     // Panary Aqua
  restOpacity: 0.2,
  activeOpacity: 0.85,
  lineOpacity: 0.1,
}

const LIGHT_COLORS: ThemeColors = {
  restR: 148, restG: 163, restB: 184,   // Slate-400
  aquaR: 0, aquaG: 184, aquaB: 212,     // Panary Aqua
  restOpacity: 0.3,
  activeOpacity: 0.7,
  lineOpacity: 0.15,
}

@Component({
  selector: 'lib-dot-grid',
  standalone: true,
  template: `<canvas #canvas class="absolute inset-0 w-full h-full"></canvas>`,
  styles: [
    `
      :host {
        display: block;
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 0;
      }
    `,
  ],
})
export class DotGridComponent implements OnDestroy {
  readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas')

  private ctx!: CanvasRenderingContext2D
  private dots: DotState[] = []
  private cols = 0
  private rows = 0
  private animationId?: number
  private mouseX = -1000
  private mouseY = -1000
  private mouseActive = false
  private colors: ThemeColors = DARK_COLORS

  private resizeHandler = () => this.rebuildGrid()
  private mouseMoveHandler = (e: MouseEvent) => this.onMouseMove(e)
  private mouseLeaveHandler = () => this.onMouseLeave()

  // Grid-Konfiguration
  private readonly SPACING = 32
  private readonly CURSOR_RADIUS = 160
  private readonly LERP_SPEED_UP = 0.12
  private readonly LERP_SPEED_DOWN = 0.04

  // Punkt-Größen (kleiner als zuvor)
  private readonly DOT_SIZE_MIN = 1
  private readonly DOT_SIZE_MAX = 3.5

  // Verbindungslinien
  private readonly LINE_ACTIVATION_THRESHOLD = 0.25

  constructor() {
    afterNextRender(() => this.init())
  }

  private init(): void {
    const canvas = this.canvasRef().nativeElement
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    this.ctx = ctx
    this.rebuildGrid()
    this.animate()
    window.addEventListener('resize', this.resizeHandler)
    window.addEventListener('mousemove', this.mouseMoveHandler)
    document.documentElement.addEventListener('mouseleave', this.mouseLeaveHandler)
  }

  private isDarkMode(): boolean {
    return document.body.classList.contains('dark')
  }

  private rebuildGrid(): void {
    const canvas = this.canvasRef().nativeElement
    const rect = canvas.parentElement?.getBoundingClientRect()
    if (!rect) return

    canvas.width = rect.width
    canvas.height = rect.height

    this.cols = Math.ceil(canvas.width / this.SPACING) + 1
    this.rows = Math.ceil(canvas.height / this.SPACING) + 1
    const total = this.cols * this.rows

    const oldDots = this.dots
    this.dots = new Array(total)
    for (let i = 0; i < total; i++) {
      this.dots[i] = { activation: oldDots[i]?.activation ?? 0 }
    }
  }

  private animate = (): void => {
    this.colors = this.isDarkMode() ? DARK_COLORS : LIGHT_COLORS
    this.update()
    this.draw()
    this.animationId = requestAnimationFrame(this.animate)
  }

  private update(): void {
    const cursorRadiusSq = this.CURSOR_RADIUS * this.CURSOR_RADIUS

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const idx = row * this.cols + col
        const dot = this.dots[idx]

        const dotX = col * this.SPACING
        const dotY = row * this.SPACING

        let targetActivation = 0

        if (this.mouseActive) {
          const dx = dotX - this.mouseX
          const dy = dotY - this.mouseY
          const distSq = dx * dx + dy * dy

          if (distSq < cursorRadiusSq) {
            const dist = Math.sqrt(distSq)
            targetActivation = 1 - dist / this.CURSOR_RADIUS
            targetActivation = targetActivation * targetActivation
          }
        }

        const speed = targetActivation > dot.activation ? this.LERP_SPEED_UP : this.LERP_SPEED_DOWN
        dot.activation += (targetActivation - dot.activation) * speed
      }
    }
  }

  private draw(): void {
    const canvas = this.canvasRef().nativeElement
    const c = this.colors

    this.ctx.clearRect(0, 0, canvas.width, canvas.height)

    this.drawConnections()

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const idx = row * this.cols + col
        const a = this.dots[idx].activation

        const x = col * this.SPACING
        const y = row * this.SPACING

        const size = this.DOT_SIZE_MIN + (this.DOT_SIZE_MAX - this.DOT_SIZE_MIN) * a

        const r = Math.round(c.restR + (c.aquaR - c.restR) * a)
        const g = Math.round(c.restG + (c.aquaG - c.restG) * a)
        const b = Math.round(c.restB + (c.aquaB - c.restB) * a)
        const opacity = c.restOpacity + (c.activeOpacity - c.restOpacity) * a

        this.ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`
        this.ctx.beginPath()
        this.ctx.arc(x, y, size, 0, Math.PI * 2)
        this.ctx.fill()
      }
    }
  }

  private drawConnections(): void {
    const c = this.colors
    this.ctx.lineWidth = 1

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const idx = row * this.cols + col
        const a = this.dots[idx].activation

        if (a < this.LINE_ACTIVATION_THRESHOLD) continue

        const x = col * this.SPACING
        const y = row * this.SPACING

        // Rechter Nachbar
        if (col < this.cols - 1) {
          const rightA = this.dots[idx + 1].activation
          if (rightA >= this.LINE_ACTIVATION_THRESHOLD) {
            const lineOpacity = Math.min(a, rightA) * c.lineOpacity
            this.ctx.strokeStyle = `rgba(${c.aquaR},${c.aquaG},${c.aquaB},${lineOpacity})`
            this.ctx.beginPath()
            this.ctx.moveTo(x, y)
            this.ctx.lineTo(x + this.SPACING, y)
            this.ctx.stroke()
          }
        }

        // Unterer Nachbar
        if (row < this.rows - 1) {
          const belowA = this.dots[idx + this.cols].activation
          if (belowA >= this.LINE_ACTIVATION_THRESHOLD) {
            const lineOpacity = Math.min(a, belowA) * c.lineOpacity
            this.ctx.strokeStyle = `rgba(${c.aquaR},${c.aquaG},${c.aquaB},${lineOpacity})`
            this.ctx.beginPath()
            this.ctx.moveTo(x, y)
            this.ctx.lineTo(x, y + this.SPACING)
            this.ctx.stroke()
          }
        }

        // Diagonaler Nachbar (rechts-unten)
        if (col < this.cols - 1 && row < this.rows - 1) {
          const diagA = this.dots[idx + this.cols + 1].activation
          if (diagA >= this.LINE_ACTIVATION_THRESHOLD) {
            const lineOpacity = Math.min(a, diagA) * c.lineOpacity * 0.6
            this.ctx.strokeStyle = `rgba(${c.aquaR},${c.aquaG},${c.aquaB},${lineOpacity})`
            this.ctx.beginPath()
            this.ctx.moveTo(x, y)
            this.ctx.lineTo(x + this.SPACING, y + this.SPACING)
            this.ctx.stroke()
          }
        }
      }
    }
  }

  private onMouseMove(event: MouseEvent): void {
    const canvas = this.canvasRef().nativeElement
    const rect = canvas.getBoundingClientRect()
    this.mouseX = event.clientX - rect.left
    this.mouseY = event.clientY - rect.top
    this.mouseActive = true
  }

  private onMouseLeave(): void {
    this.mouseActive = false
  }

  ngOnDestroy(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
    }
    window.removeEventListener('resize', this.resizeHandler)
    window.removeEventListener('mousemove', this.mouseMoveHandler)
    document.documentElement.removeEventListener('mouseleave', this.mouseLeaveHandler)
  }
}
