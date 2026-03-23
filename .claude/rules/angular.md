# Angular-Regeln – Panary Core

Angular 21+, ausschließlich Standalone-Architektur. Alle Regeln sind verbindlich.

---

## 1. Control Flow (Block-Syntax)

**NIEMALS** Strukturdirektiven verwenden.

| Verboten | Korrekt |
|---|---|
| `*ngIf="..."` | `@if (bedingung) { ... } @else { ... }` |
| `*ngFor="let x of list"` | `@for (x of list; track x.id) { ... } @empty { ... }` |
| `*ngSwitch` / `*ngSwitchCase` | `@switch (wert) { @case (a) { ... } @default { ... } }` |

**Pflicht in `@for`:** `track`-Ausdruck immer angeben (bevorzugt eindeutige ID).

---

## 2. Reaktivität (Signals)

Signals gegenüber RxJS `BehaviorSubject` für lokalen Zustand bevorzugen.

```typescript
// Zustand
count = signal<number>(0)

// Abgeleiteter Wert
doubled = computed(() => this.count() * 2)

// Seiteneffekt (sparsam verwenden)
constructor() {
  effect(() => {
    console.log('count changed:', this.count())
  })
}
```

RxJS ist weiterhin für HTTP, komplexe async-Ströme und `toSignal()` / `toObservable()` legitim.

---

## 3. Inputs & Outputs (Signal-APIs)

**NICHT** `@Input()` oder `@Output()` mit `EventEmitter` verwenden.

```typescript
// Signal-Input (optional mit Default)
myInput = input<string>('')

// Signal-Input (erforderlich)
myRequiredInput = input.required<number>()

// Output (keine EventEmitter)
myEvent = output<string>()

// Emit
this.myEvent.emit('wert')
```

---

## 4. Queries (Signal-APIs)

**NICHT** `@ViewChild` oder `@ContentChild` verwenden.

```typescript
// ViewChild
myRef = viewChild<ElementRef>('ref')
myOptionalRef = viewChild<MyComponent>(MyComponent)

// ContentChild / ContentChildren
header = contentChild<HeaderComponent>(HeaderComponent)
items = contentChildren<ItemComponent>(ItemComponent)
```

---

## 5. Dependency Injection

**NICHT** über den `constructor` injizieren. Immer `inject()` verwenden.

```typescript
// KORREKT
private authService = inject(AuthService)
private route = inject(ActivatedRoute)
private router = inject(Router)

// FALSCH
constructor(private authService: AuthService) {}
```

---

## 6. Komponenten-Architektur

```typescript
@Component({
  selector: 'app-my-component',
  standalone: true,                              // Pflicht
  imports: [CommonModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush, // Pflicht
  template: `
    @if (user(); as u) {
      <h1>{{ u.name }}</h1>
    } @else {
      <p>Laden…</p>
    }
  `,
})
export class MyComponent {
  private userService = inject(UserService)

  userId = input.required<string>()
  saved = output<void>()

  user = signal<User | null>(null)
  fullName = computed(() => `${this.user()?.firstName} ${this.user()?.lastName}`)

  constructor() {
    effect(() => this.loadUser(this.userId()))
  }

  private async loadUser(id: string) {
    this.user.set(await this.userService.getById(id))
  }

  onSave() {
    this.saved.emit()
  }
}
```

**Checkliste für jede Komponente:**
- [ ] `standalone: true`
- [ ] `changeDetection: ChangeDetectionStrategy.OnPush`
- [ ] `inject()` statt Konstruktor-DI
- [ ] Signal-Inputs statt `@Input()`
- [ ] `output()` statt `@Output()` + EventEmitter
- [ ] Block-Control-Flow statt Strukturdirektiven
- [ ] Keine NgModules erstellen

---

## 7. Formulare

### Priorität (absteigend)

1. **Signal Forms** — zukunftsorientierter Standard (sobald stabil/verfügbar)
2. **Typed Reactive Forms** — aktueller Standard für komplexe Formulare
3. **Template-driven Forms** — nur für sehr einfache, einmalige Formulare ohne Business-Logik

### Signal Forms (bevorzugt, zukunftsorientiert)

Signal Forms sind die strategische Weiterentwicklung von Angular-Formularen und integrieren sich nativ in die Signal-Architektur. Sobald die API stabil ist, werden sie als primärer Standard eingesetzt.

```typescript
// Signal Forms (Angular experimental / zukünftiger Standard)
import { FormField, FormGroup } from '@angular/forms' // API noch in Entwicklung

form = new FormGroup({
  name: new FormField(''),
  email: new FormField(''),
})

// Formularwert ist ein Signal — reaktive Ableitung möglich
fullName = computed(() => this.form.value().name)
```

**Vorteile gegenüber Reactive Forms:**
- Formularwerte und -status sind Signals — kein `.valueChanges` Observable mehr nötig
- Nahtlose Integration mit `computed()` und `effect()`
- `OnPush`-kompatibel ohne manuelle `markForCheck()`-Aufrufe

### Typed Reactive Forms (aktueller Standard)

```typescript
form = new FormGroup({
  name: new FormControl<string>('', { nonNullable: true }),
  email: new FormControl<string>('', { nonNullable: true }),
})
```

---

## 8. Lifecycle

`implements OnInit` nur bei Bedarf. Logik bevorzugt im Constructor oder bei der Feld-Initialisierung:

```typescript
// Bevorzugt: Initialisierung via effect() im constructor
constructor() {
  effect(() => this.load(this.id()))
}

// Nur wenn notwendig: ngOnInit
ngOnInit() {
  this.loadOnce()
}
```

---

## 9. Nx-Generator für Komponenten

Vor manueller Erstellung prüfen, ob ein Nx-Generator existiert:

```bash
nx g @nx/angular:component --name=[name] --project=[project] --standalone
```
