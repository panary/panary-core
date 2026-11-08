---
paths:
  - 'apps/pos-client/**'
  - 'libs/shared/data-access*/**'
  - 'libs/domains/*/feature-*/**'
  - 'libs/domains/*/data-access/**'
---

# Logging-Regeln – POS-Frontend

> Gilt für den POS-Client und die Frontend-Libs mit Daten- und Feature-Code (`paths` oben); dort sitzt fast
> jeder `console.*`-Aufruf, die übrigen Libs des POS halten sich trotzdem daran. Das Backend (Winston, Wide Events)
> regelt `logging.md`; dessen Regeln gelten hier nicht. Entscheidung: [ADR 0069](../../docs/adr/0069-pos-fehlerberichte-bleiben-lokal.md).

## 1. Jede Konsolenzeile landet auf der Platte

`installGlobalLogCapture()` (`libs/shared/data-access-updater`, geladen als erstes Modul von
`apps/pos-client/src/main.ts`) spiegelt **jedes** `console.error`, `console.warn` und `console.info`
ungefiltert in die native Logdatei `panary-pos.log` (unter Tauri im App-Log-Verzeichnis, im
Android-Wrapper unter `Directory.Data/logs/`), dazu unbehandelte Fehler und Ablehnungen. Dasselbe
gilt für `LogService.error/warn/info` (`debug` fällt am Level `Info` weg). Es gibt keinen Scrubber dazwischen.

Die Datei bleibt auf dem Gerät, wird aber per „Logs exportieren" (Android: Teilen-Menü) **von Hand an den Support geschickt**
und landet dort in E-Mails und Tickets. Was in `console.*` steht, ist damit eine Aussage gegenüber
Dritten, keine Entwickler-Notiz. `console.log` und `console.debug` werden nicht gespiegelt, gehören im
ausgelieferten Code aber trotzdem nicht in Pfade mit den Daten aus §2.

## 2. Was nie in `console.*` oder `LogService` steht

| Nie                                                         | Stattdessen                                    |
| ----------------------------------------------------------- | ---------------------------------------------- |
| PIN, Passwort, Einmalcode, Kopplungscode                    | dass geprüft wurde und mit welchem Ergebnis    |
| JWT, API-Key, Geräteschlüssel, `Authorization`-Header       | Gerät- oder User-`_id`                         |
| Kundendaten: Name, E-Mail, Telefon, Adresse, Notiz          | Kunden-`_id`                                   |
| Bestell- und Zahlungsinhalt: Positionen, Beträge, Bon-Text  | Bestell-`_id`, Anzahl Positionen, Status       |
| ganze Request-/Response-Bodies, ganze Service-Ergebnisse    | Service-Pfad, Methode, Statuscode, Fehler-Code |
| ganze Konfigurations- oder Speicherobjekte (`localStorage`) | das eine Feld, um das es geht, ohne Geheimnis  |

Eine `_id` ist erlaubt: Sie verknüpft die Zeile mit dem Datensatz, ohne seinen Inhalt preiszugeben.

## 3. Fehlerobjekte nur mit Name, Meldung und Stack

Der Mitschnitt schreibt für jedes `instanceof Error` nur `Name: Meldung` und den Stack. Deshalb ist
`console.error('…', err)` mit einem echten `Error` richtig, auch mit einem Feathers-Fehler (`FeathersError`
erbt von `Error`, sein `data` landet nicht in der Datei). Alles **andere** schreibt er per
`JSON.stringify` vollständig:

- **`HttpErrorResponse`** (Angular) ist kein `Error`. Er trägt den Antwort-Body (`error`), die `url` samt
  Query und die Header, und seine `message` nennt die URL ebenfalls. Solche Fehler nur mit `err.status`
  nennen.
- **Objekte als Kontext** (`console.warn('Sync fehlgeschlagen', record)`) schreiben den ganzen Datensatz.
  Nur die Felder aus §2 „Stattdessen" übergeben.
- **Fehler unbekannter Form** (roher Socket-Callback, `catch (error: unknown)` mit `HttpErrorResponse`):
  `describeErrorForLog(error)` aus `@panary/shared/data-access` übergeben. Er liefert Name, Code und
  Meldung als Zeichenkette, nie `data`, beim `HttpErrorResponse` nur Name und Status.
- **`JSON.parse`-Fehler** über gespeicherte Werte: Die `SyntaxError`-Meldung zitiert die Eingabe (V8 zehn
  Zeichen, WebKit den ersten Bezeichner). Nur Schlüssel und `errorName(error)` nennen.
- **Geworfene Nicht-Fehler** (`throw response`, `Promise.reject(data)`) landen als unbehandelte Ablehnung
  ebenso vollständig in der Datei. Geworfen wird ein `Error`.

## 4. Fehlerbehandlung schreibt selbst nichts doppelt

Ein Fehler, der unbehandelt bleibt, steht über Angulars `ErrorHandler` schon einmal mit Stack in der
Datei. Wer ihn fängt, protokolliert ihn **einmal** an der Stelle, die ihn behandelt, und wirft ihn dann
nicht erneut nach oben, nur um ihn zu loggen.

## 5. Prüfen

Kein Gate prüft diese Regel; sie lebt vom Review (`rules-reviewer`). Den Bestand misst:

```bash
grep -rn "console\.\(error\|warn\|info\)" apps/pos-client/src libs/shared/data-access* \
  libs/domains/*/feature-* libs/domains/*/data-access --include='*.ts' | grep -v '\.spec\.ts'
```
