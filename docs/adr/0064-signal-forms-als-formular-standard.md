---
type: ADR
title: 'Signal Forms als Formular-Standard'
description: 'ADR zur Formular-API in panary-core: Signal Forms (`@angular/forms/signals`) werden Pflicht für neue und geänderte Formulare, Reactive Forms sind entfernt, template-driven Formulare bleiben Bestand bis zur Umstellung in #1173 und #1174.'
tags: [angular, frontend, forms, setup-client, admin-client, pos]
status: stable
decision: accepted
implementation: 'Reactive Forms umgestellt in panary/panary-core#1017; template-driven offen in #1173 und #1174'
generated: { by: claude-code/opus-5.5, at: 2026-10-28T01:30:00Z }
sources:
  - { id: issue-1017, resource: 'https://github.com/panary/panary-core/issues/1017', title: 'Formulare auf Signal Forms umstellen und Formular-Regel anpassen' }
  - { id: issue-129, resource: 'https://github.com/panary/panary-core/issues/129', title: 'Angular 22 + Nx 23' }
  - { id: regel, resource: '.claude/rules/angular.md', title: 'Angular-Regeln §7 Formulare' }
---

# Signal Forms als Formular-Standard

## Problem

Die Formular-Regel (`.claude/rules/angular.md` §7) verlangte Typed Reactive Forms und nannte Signal Forms
„bevorzugt, sobald stabil“. Ihr Beispiel importierte `FormField, FormGroup` aus `@angular/forms`; das ist
nicht die Signal-Forms-API, die liegt unter `@angular/forms/signals`. Mit Angular 22 (#129) ist diese API
als `@publicApi 22.0` markiert, also stabil.

Im Code standen drei Formular-Arten nebeneinander, gemessen am 2026-10-28 auf `origin/main` @ `dbf05376`:

| Art | Dateien | Wo |
| --- | --- | --- |
| Reactive Forms | 3 | Setup-Wizard, Abschreibungsdialog (nur das Suchfeld), Vorbestell-Schnelldialog |
| Template-driven (`FormsModule`, `ngModel`) | 24 | 17 im Admin-Client, 7 in POS-Libs |
| Signal Forms | 0 | — |

Reactive Forms passen schlecht zur zonenlosen OnPush-Architektur: `form.invalid` ist kein Signal. Der
Vorbestelldialog brauchte deshalb `markForCheck()` nach jedem Tastendruck der Touch-Tastatur, und ein
fehlender Aufruf ließ „Weiter“ still gesperrt.

## Entscheidung

1. **Signal Forms sind Pflicht** für jedes neue und jedes geänderte Formular. Validierung steht im
   Schema von `form()`. Das Modell ist ein normales `signal()`, sein Wert ist der Formularwert.
2. **Reactive Forms werden entfernt** (#1017, drei Dateien) und nicht neu eingeführt.
3. **Template-driven Formulare bleiben Bestand**, bis #1173 (Admin-Client) und #1174 (POS-Libs) sie
   umstellen. Wer eine dieser Dateien ohnehin ändert, stellt das berührte Formular mit um.
4. **`<form>` bekommt `[formRoot]`, der Handler hängt an `(submit)`.** Ohne `FormsModule` sitzt keine
   `NgForm`-Direktive mehr am Element, die den nativen Submit abfängt.

Verworfen: die Interop (`@angular/forms/signals/compat`), also Reactive-Controls in Signal Forms
einzuhängen. Bei drei Dateien war die vollständige Umstellung kleiner als eine Übergangsschicht.

## Konsequenzen

- Formularstatus ist ein Signal (`form().invalid()`, `form.feld().value()`). `markForCheck()` nach
  programmatischen Änderungen entfällt; im Vorbestelldialog fiel `ChangeDetectorRef` ganz weg.
- Die Reaktion auf Eingaben läuft über `computed()` oder `linkedSignal()`, nicht über `valueChanges`.
  Der Abschreibungsdialog setzt die Auswahl beim Tippen per `linkedSignal` auf dem Suchbegriff zurück.
- **Specs in `environment: 'node'`** (die meisten POS-Libs) können `form()` nicht ohne Weiteres
  bauen: Es verlangt `APP_ID`, `ɵChangeDetectionScheduler` und `ɵEffectScheduler`, die sonst die
  Plattform stellt. Die Specs aus #1017 stubben sie in einem `createEnvironmentInjector`. Das hängt an
  zwei privaten `ɵ`-Exporten und kann bei einem Angular-Update brechen; die Fehlermeldung ist dann ein
  `NG0201 No provider found` beim Instanziieren, kein stiller Fehlschlag.
- Die Regel benennt den Bestand mit Issue-Nummern. Solange #1173 und #1174 offen sind, gibt es zwei
  Formular-Arten im Code.
- panary-cloud zieht dieselbe Regeländerung in einem eigenen Issue nach (dort 42 Dateien).
