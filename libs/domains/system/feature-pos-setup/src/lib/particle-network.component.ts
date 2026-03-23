import { Component, ElementRef, OnInit, OnDestroy, ViewChild, afterNextRender } from '@angular/core'
import { CommonModule } from '@angular/common'

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
}

@Component({
  selector: 'app-particle-network',
  standalone: true,
  imports: [CommonModule],
  template: `
    <canvas
      #canvas
      class="absolute inset-0 w-full h-full"
      (mousemove)="onMouseMove($event)"
      (mouseleave)="onMouseLeave()"
    ></canvas>
  `,
  styles: [
    `
      :host {
        display: block;
        position: absolute;
        inset: 0;
        pointer-events: none;
      }
      canvas {
        pointer-events: auto;
      }
    `,
  ],
})
export class ParticleNetworkComponent implements OnInit, OnDestroy {
  @ViewChild('canvas', { static: true }) canvasRef!: ElementRef<HTMLCanvasElement>

  private ctx!: CanvasRenderingContext2D
  private particles: Particle[] = []
  private animationId?: number
  private mouseX = 0
  private mouseY = 0
  private mouseActive = false

  private readonly PARTICLE_COUNT = 60
  private readonly MAX_DISTANCE = 150
  private readonly MOUSE_RADIUS = 200
  private readonly PARTICLE_SIZE = 2
  private readonly SPEED = 0.3

  // Panary Colors
  private readonly COLOR_AQUA = '#00B8D4'
  private readonly COLOR_NAVY = '#0F172A'

  constructor() {
    afterNextRender(() => {
      this.init()
    })
  }

  ngOnInit(): void {}

  private init(): void {
    const canvas = this.canvasRef.nativeElement
    const ctx = canvas.getContext('2d')

    if (!ctx) return

    this.ctx = ctx
    this.resizeCanvas()
    this.createParticles()
    this.animate()

    window.addEventListener('resize', () => this.resizeCanvas())
  }

  private resizeCanvas(): void {
    const canvas = this.canvasRef.nativeElement
    const rect = canvas.parentElement?.getBoundingClientRect()

    if (rect) {
      canvas.width = rect.width
      canvas.height = rect.height
    }
  }

  private createParticles(): void {
    const canvas = this.canvasRef.nativeElement
    this.particles = []

    for (let i = 0; i < this.PARTICLE_COUNT; i++) {
      this.particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * this.SPEED,
        vy: (Math.random() - 0.5) * this.SPEED,
      })
    }
  }

  private animate = (): void => {
    this.update()
    this.draw()
    this.animationId = requestAnimationFrame(this.animate)
  }

  private update(): void {
    const canvas = this.canvasRef.nativeElement

    this.particles.forEach(particle => {
      // Mouse interaction
      if (this.mouseActive) {
        const dx = this.mouseX - particle.x
        const dy = this.mouseY - particle.y
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance < this.MOUSE_RADIUS) {
          const force = (this.MOUSE_RADIUS - distance) / this.MOUSE_RADIUS
          particle.vx -= (dx / distance) * force * 0.05
          particle.vy -= (dy / distance) * force * 0.05
        }
      }

      // Update position
      particle.x += particle.vx
      particle.y += particle.vy

      // Bounce off walls
      if (particle.x < 0 || particle.x > canvas.width) {
        particle.vx *= -1
        particle.x = Math.max(0, Math.min(canvas.width, particle.x))
      }
      if (particle.y < 0 || particle.y > canvas.height) {
        particle.vy *= -1
        particle.y = Math.max(0, Math.min(canvas.height, particle.y))
      }

      // Damping
      particle.vx *= 0.99
      particle.vy *= 0.99

      // Minimum speed
      const speed = Math.sqrt(particle.vx * particle.vx + particle.vy * particle.vy)
      if (speed < this.SPEED * 0.5) {
        const angle = Math.random() * Math.PI * 2
        particle.vx = Math.cos(angle) * this.SPEED
        particle.vy = Math.sin(angle) * this.SPEED
      }
    })
  }

  private draw(): void {
    const canvas = this.canvasRef.nativeElement
    this.ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw connections (triangles)
    this.drawConnections()

    // Draw particles
    this.particles.forEach(particle => {
      this.ctx.fillStyle = this.COLOR_AQUA + '40' // 25% opacity
      this.ctx.beginPath()
      this.ctx.arc(particle.x, particle.y, this.PARTICLE_SIZE, 0, Math.PI * 2)
      this.ctx.fill()
    })
  }

  private drawConnections(): void {
    const drawnTriangles = new Set<string>()

    for (let i = 0; i < this.particles.length; i++) {
      for (let j = i + 1; j < this.particles.length; j++) {
        const dx = this.particles[i].x - this.particles[j].x
        const dy = this.particles[i].y - this.particles[j].y
        const distance = Math.sqrt(dx * dx + dy * dy)

        if (distance < this.MAX_DISTANCE) {
          // Draw line
          const opacity = (1 - distance / this.MAX_DISTANCE) * 0.15
          this.ctx.strokeStyle =
            this.COLOR_NAVY +
            Math.floor(opacity * 255)
              .toString(16)
              .padStart(2, '0')
          this.ctx.lineWidth = 1
          this.ctx.beginPath()
          this.ctx.moveTo(this.particles[i].x, this.particles[i].y)
          this.ctx.lineTo(this.particles[j].x, this.particles[j].y)
          this.ctx.stroke()

          // Find third point to form triangle
          for (let k = j + 1; k < this.particles.length; k++) {
            const dx2 = this.particles[i].x - this.particles[k].x
            const dy2 = this.particles[i].y - this.particles[k].y
            const distance2 = Math.sqrt(dx2 * dx2 + dy2 * dy2)

            const dx3 = this.particles[j].x - this.particles[k].x
            const dy3 = this.particles[j].y - this.particles[k].y
            const distance3 = Math.sqrt(dx3 * dx3 + dy3 * dy3)

            if (distance2 < this.MAX_DISTANCE && distance3 < this.MAX_DISTANCE) {
              const triangleKey = [i, j, k].sort().join('-')

              if (!drawnTriangles.has(triangleKey)) {
                drawnTriangles.add(triangleKey)

                // Draw triangle fill
                const avgDistance = (distance + distance2 + distance3) / 3
                const fillOpacity = (1 - avgDistance / this.MAX_DISTANCE) * 0.03
                this.ctx.fillStyle =
                  this.COLOR_AQUA +
                  Math.floor(fillOpacity * 255)
                    .toString(16)
                    .padStart(2, '0')
                this.ctx.beginPath()
                this.ctx.moveTo(this.particles[i].x, this.particles[i].y)
                this.ctx.lineTo(this.particles[j].x, this.particles[j].y)
                this.ctx.lineTo(this.particles[k].x, this.particles[k].y)
                this.ctx.closePath()
                this.ctx.fill()
              }
            }
          }
        }
      }
    }
  }

  onMouseMove(event: MouseEvent): void {
    const canvas = this.canvasRef.nativeElement
    const rect = canvas.getBoundingClientRect()
    this.mouseX = event.clientX - rect.left
    this.mouseY = event.clientY - rect.top
    this.mouseActive = true
  }

  onMouseLeave(): void {
    this.mouseActive = false
  }

  ngOnDestroy(): void {
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
    }
    window.removeEventListener('resize', () => this.resizeCanvas())
  }
}
