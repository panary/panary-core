---
paths:
  - 'apps/pos-client/**'
  - 'apps/setup-client/**'
  - 'apps/admin-client/**'
  - 'libs/**/feature-*/**'
  - 'libs/shared/ui-*/**'
  - 'libs/**/data-access*/**'
  - 'libs/apps/**'
---

# Angular-Regeln – Panary Core

Angular 21+, ausschließlich Standalone-Architektur. Alle Regeln sind verbindlich.

---

## 1. Control Flow (Block-Syntax)

**NIEMALS** Strukturdirektiven verwenden.

| Verboten                      | Korrekt                                                 |
| ----------------------------- | ------------------------------------------------------- |
| `*ngIf="..."`                 | `@if (bedingung) { ... } @else { ... }`                 |
| `*ngFor="let x of list"`      | `@for (x of list; track x.id) { ... } @empty { ... }`   |
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

### 2.1 `effect()` + async-Aufruf — Pflicht-`untracked()`

> **Jeder async-Aufruf innerhalb eines `effect()` muss in `untracked()` gewrappt sein, wenn er Signals liest/schreibt.**

Anti-Pattern (führt zu Endlos-Loop):

```typescript
effect(() => {
  if (this.isAuthenticated()) {
    void this.store.refresh() // refresh() liest isLoading() vor erstem await
    // → Read landet im Effect-Tracking-Scope.
    // refresh() setzt isLoading.set(true)
    // → Effect läuft erneut → permanente API-Calls.
  }
})
```

Korrektes Pattern:

```typescript
import { effect, untracked } from '@angular/core'

effect(() => {
  if (this.isAuthenticated()) {
    untracked(() => void this.store.refresh())
  }
})
```

Wenn der Effect bewusst auf ein Signal reagieren soll (z. B. `input()`-Änderung), Read **vor** dem `untracked()` machen:

```typescript
effect(() => {
  const id = this.userId() // bewusst getrackt
  untracked(() => this.loadUser(id)) // Body NICHT getrackt
})
```

**Wann untracked()?**

- Immer wenn der Effect-Body eine async-Methode mit `void this.x()` oder `await this.x()` aufruft, die intern Signal-State manipuliert
- Bei Service-Lookups via `signal-getter()`, die in der async-Methode VOR dem ersten `await` stehen
- Bei Unsicherheit: defensiv setzen — kein Performance-Nachteil, schützt vor Loop

**Symptom-Erkennung:** Wenn das Backend-Log permanent `GET /xxx` im Sekunden-Takt zeigt → Effect-Loop in einer Frontend-Komponente.

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
  standalone: true, // Pflicht
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
    // userId() bewusst getrackt; loadUser-Body via untracked() entkoppelt
    // (siehe §2.1) — verhindert Endlos-Loop falls loadUser intern Signals setzt.
    effect(() => {
      const id = this.userId()
      untracked(() => this.loadUser(id))
    })
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

### 6.1 Edge-Oberflächen sind kein Secure Context

`admin-client` und `setup-client` kommen von api-edge per **HTTP auf der LAN-IP**. Dort fehlen alle
Browser-APIs, die einen Secure Context verlangen — `navigator.clipboard` ist `undefined`, ebenso
`crypto.subtle` und WebAuthn. Lokal über `localhost` fällt das nicht auf, denn `localhost` gilt als sicher.

- **Kopieren:** `Clipboard` aus `@angular/cdk/clipboard` (`clipboard.copy(text)` → `boolean`, mit
  `execCommand`-Fallback), nie `navigator.clipboard`. Das Ergebnis steuert „Kopiert" bzw. eine sichtbare
  Fehlermeldung — kein leerer `catch` (panary/panary-core#550).
- Jede andere Secure-Context-API vor Benutzung prüfen (`window.isSecureContext`) und einen Rückweg anbieten.
- Der `pos-client` läuft in Tauri und ist nicht betroffen.

---

## 7. Formulare

**Signal Forms (`@angular/forms/signals`) sind Pflicht** für jedes neue und jedes geänderte Formular
([ADR 0064](../../docs/adr/0064-signal-forms-als-formular-standard.md), panary/panary-core#1017).

| Form                                           | Stand                                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Signal Forms                                   | Standard                                                                                                                                                             |
| Reactive Forms (`FormGroup`, `FormBuilder`, …) | 🚫 im Code nicht mehr vorhanden, nicht neu einführen                                                                                                                 |
| Template-driven (`FormsModule`, `ngModel`)     | Bestand bis zur Umstellung (panary/panary-core#1173 Admin-Client, panary/panary-core#1174 POS-Libs). Wer eine dieser Dateien ändert, stellt das berührte Formular um |

```typescript
import { email, form, FormField, FormRoot, minLength, required, validate } from '@angular/forms/signals'

@Component({
  imports: [FormField, FormRoot],
  template: `
    <form [formRoot]="form" (submit)="save()">
      <input [formField]="form.email" type="email" />
      <input [formField]="form.password" type="password" />
      <input [formField]="form.passwordConfirm" type="password" />
      <button type="submit" [disabled]="form().invalid()">Speichern</button>
    </form>
  `,
})
export class AccountFormComponent {
  // Das Modell ist ein normales Signal — sein Wert ist der Formularwert.
  readonly account = signal({ email: '', password: '', passwordConfirm: '' })

  readonly form = form(this.account, a => {
    required(a.email)
    email(a.email)
    required(a.password)
    minLength(a.password, 8)
    validate(a.passwordConfirm, ({ value, valueOf }) =>
      value() === valueOf(a.password) ? undefined : { kind: 'mismatch' },
    )
  })

  save() {
    if (this.form().invalid()) return
    const value = this.account()
    // …
  }
}
```

**Regeln:**

- **Validierung steht im Schema**, nicht im Template und nicht im Submit-Handler. Felder lesen
  `form.feld().value()`, `.valid()`, `.errors()`; das ganze Formular `form().invalid()`.
- **Schreiben ohne Eingabefeld** (Touch-Tastatur, Scroll-Wheel, Kachel-Auswahl): `form.feld().value.set(…)`
  oder direkt auf das Modell-Signal. Kein `markForCheck()` nötig.
- **`<form>` bekommt `[formRoot]`.** Ohne `FormsModule` hängt keine `NgForm`-Direktive mehr am Element;
  `FormRoot` setzt `novalidate` und ruft `preventDefault()` — ohne ihn lädt ein Submit die Seite neu.
  Der eigene Handler hängt an `(submit)`, nicht an `(ngSubmit)`.
- **Kein `[disabled]` an einem Element mit `[formField]`.** Deaktivierung gehört ins Schema (`disabled(p.feld, …)`).
  Buttons sind keine Felder und dürfen `[disabled]` tragen.
- **Reaktion auf Eingaben** über `computed()` oder `linkedSignal()` auf dem Modell, nicht über ein `effect()`
  mit Signal-Writes (§2.1). Beispiel: eine Auswahl, die beim Tippen im Suchfeld verfällt, ist ein
  `linkedSignal({ source: suchbegriff, computation: () => null })`.
- **Specs in `environment: 'node'`** (ohne TestBed) brauchen für `form()` drei Provider, die sonst die
  Plattform stellt: `APP_ID`, `ɵChangeDetectionScheduler` und `ɵEffectScheduler` (Stubs genügen, die
  Validierung sind computed-Signale). Vorlage: `pre-order-quick-dialog.spec.ts`.

---

## 8. Lifecycle

`implements OnInit` nur bei Bedarf. Logik bevorzugt im Constructor oder bei der Feld-Initialisierung:

```typescript
// Bevorzugt: Initialisierung via effect() im constructor.
// id() bewusst getrackt; load-Body in untracked() (siehe §2.1).
constructor() {
  effect(() => {
    const id = this.id()
    untracked(() => this.load(id))
  })
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
