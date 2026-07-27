# DPI-Analyse — PNRY-FEAT-POS-UI-SCALE-001 (fluide UI-Skalierung POS-Client)

Analyse-Stand: 2026-07-27 · Nur Analyse + Boot-Logging, kein Umbau.

## 1. Wie WebView2 (Windows) das OS-DPI-Scaling durchreicht

Tauri v2 nutzt auf Windows WebView2 (Chromium). Chromium arbeitet in **DIPs** (Device Independent
Pixels): CSS-Pixel sind DIPs, das OS-Display-Scaling (100/125/150 %) wird ausschließlich über
`devicePixelRatio` (1 / 1.25 / 1.5) abgebildet. Der CSS-Viewport schrumpft bei höherem Scaling
entsprechend (physische Breite ÷ dPR) — das Rendering bleibt vektorbasiert und scharf.

**Config-Befunde (keine Doppel-Skalierung zu erwarten):**

- `apps/pos-client/src-tauri/tauri.conf.json`: Fenster `1280×800` (logische Pixel/DIPs),
  `resizable: true`, `fullscreen: false`. **Keine** DPI-relevanten Overrides (kein
  Scale-Factor-Override, kein DPI-Awareness-Flag) — Tauri v2 ist per Default
  Per-Monitor-DPI-aware.
- `src-tauri/src/lib.rs` / `main.rs`: keinerlei Window-/Monitor-/Scale-Factor-Manipulation
  (nur mDNS-Discovery, Logging, Updater). Es gibt also keine zweite Skalierungsschicht
  neben dem OS.
- Kein `zoom`/`transform: scale()` im globalen CSS — die einzige Skalierungsquelle im
  Frontend ist die neue Root-Fontsize-Formel (flag-gated via `html.pnry-fluid-scale`).

## 2. Wechselwirkung OS-Scaling ↔ vw-basierte clamp()-Formel

`font-size: clamp(14px, 0.6vw + 9px, 22px) × Density` rechnet mit **CSS-Viewportbreite** —
bei höherem OS-Scaling schrumpft der Viewport und damit der vw-Anteil.

Rechenbeispiel 2560-px-Monitor (physisch), Density 1, Fenster maximiert:

| OS-Scaling | dPR  | CSS-Viewport | 0.6vw + 9px | Root-Fontsize (clamp) | physisch (× dPR) |
|-----------:|-----:|-------------:|------------:|----------------------:|-----------------:|
| 100 %      | 1.0  | 2560 px      | 24.36 px    | **22 px** (Max-Deckel) | 22.0 px          |
| 125 %      | 1.25 | 2048 px      | 21.29 px    | **21.29 px**           | 26.6 px          |
| 150 %      | 1.5  | ~1707 px     | 19.24 px    | **19.24 px**           | 28.9 px          |

Erwartetes, korrektes Verhalten: In CSS-px sinkt die Root-Fontsize mit steigendem Scaling,
physisch wächst die Schrift trotzdem (OS-Absicht „größer darstellen" bleibt erfüllt) — keine
multiplikative Doppel-Skalierung. Der `--pnry-root-fs-max`-Deckel greift nur bei 100 % auf
sehr breiten Displays; das ist gewollt (Token ohne Codeänderung anpassbar).

## 3. Verifikation auf dem echten Windows-Terminal

Beim POS-Boot loggt `apps/pos-client/src/main.ts` jetzt `[pos-boot] display-metrics`
(devicePixelRatio, innerWidth/innerHeight, screen.width/height) — via `js_log` landet die
Konsole nicht automatisch im nativen Log, daher DevTools-Konsole bzw. Logs-Ansicht nutzen.

1. Windows-Scaling auf 100 % → App starten → Logzeile prüfen: `devicePixelRatio: 1`,
   `innerWidth` ≈ physische Fensterbreite.
2. Scaling auf 125 % / 150 % umstellen, App **neu starten** → `devicePixelRatio: 1.25 / 1.5`,
   `innerWidth` schrumpft ≈ ÷ dPR, `screen.width` = logische Bildschirmbreite.
3. Sichtprüfung: Schrift scharf (kein Bitmap-Blur), Elemente physisch größer, aber nicht
   um dPR² vergrößert.

## 4. Kriterien für ein separates DPI-Ticket

Auskoppeln, wenn auf dem echten Terminal eines davon auftritt:

- `devicePixelRatio` entspricht **nicht** dem eingestellten OS-Scaling (z. B. konstant 1).
- `innerWidth` schrumpft bei höherem Scaling **nicht** (Hinweis auf Doppel-Skalierung
  oder fehlende DPI-Awareness → UI wäre unscharf hochskaliert).
- Fensterwechsel zwischen Monitoren mit unterschiedlichem Scaling aktualisiert dPR/Viewport
  nicht live (Per-Monitor-v2-Problem).
- Die clamp()-Werte führen bei 125/150 % zu real zu kleinen Touch-Targets trotz
  48px-Floor (dann Formel-Parameter monitor-/dpi-abhängig nachsteuern).
