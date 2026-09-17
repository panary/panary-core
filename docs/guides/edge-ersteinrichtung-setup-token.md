---
type: Guide
title: Edge einrichten — das Setup-Token finden und verwenden
description: Der Einrichtungs-Assistent verlangt seit der Härtung ein Token, das der Edge beim Start des Setup-Modus ausgibt; diese Anleitung zeigt, wo es steht, wie lange es gilt und was die Ablehnungen bedeuten.
tags: [api-edge, setup-client, setup, security, deployment]
status: stable
generated: { by: claude-code/opus-5, at: 2026-09-17T12:50:00.000Z }
sources:
  - { id: adr-0041, resource: docs/adr/0041-setup-zugang-per-einmal-token.md, title: ADR 0041 — Setup-Zugang per Einmal-Token }
  - { id: setup-app, resource: apps/api-edge/src/setup-app.ts, title: Setup-Modus des Edge }
  - { id: setup-token, resource: apps/api-edge/src/utils/setup-token.ts, title: Token-Guard }
---

# Edge einrichten — das Setup-Token

Ein frisch installierter Edge startet im **Setup-Modus** und liefert den
Einrichtungs-Assistenten unter `http://<edge-ip>:3030` aus. Der Assistent fragt als erstes
ein **Setup-Token** ab. Grund: Ohne diesen Nachweis konnte jeder im Netz den Edge
einrichten — es gibt zu diesem Zeitpunkt noch kein Benutzerkonto, gegen das sich jemand
anmelden könnte ([ADR 0041](../adr/0041-setup-zugang-per-einmal-token.md)).

## Wo das Token steht

Der Edge gibt es beim Start des Setup-Modus an **zwei** Stellen aus — beide setzen Zugriff
auf den Host voraus, und genau das ist der Nachweis.

**1. Container-Log:**

```bash
docker logs panary-edge 2>&1 | grep -A4 "SETUP-MODUS"
```

```
================================================================
  PANARY EDGE — SETUP-MODUS

  Setup-Token:  K7M2-9XQF
  Gueltig bis:  2026-09-17T13:15:00.000Z (30 Minuten)
================================================================
```

**2. Datei im Datenverzeichnis** (Modus `0600`, nur für den Container-Benutzer lesbar):

```bash
sudo cat /opt/panary-edge/data/setup-token.txt
```

Nach erfolgreicher Einrichtung wird die Datei entfernt und das Token entwertet.

ℹ️ **Das Token steht nur auf stdout, nicht in `data/logs/`.** Die rotierenden Log-Dateien des
Edge landen über den `log-export` in einem Archiv, das auch an den externen Support geht —
dort taucht lediglich `setup.token_issued` mit der Frist auf, nie das Token selbst.

## Eingabe

Groß-/Kleinschreibung und der Bindestrich spielen keine Rolle — `k7m29xqf` wird genauso
angenommen wie `K7M2-9XQF`. Das Alphabet enthält kein `I`, `L`, `O` oder `U`, damit beim
Abtippen keine Verwechslung mit `1` und `0` entsteht.

## Was die Meldungen bedeuten

| Meldung im Assistenten | HTTP | Ursache | Weg |
| --- | --- | --- | --- |
| „Das Setup-Token stimmt nicht." | 401 | Tippfehler oder falsches Token | Aus dem Log erneut abtippen |
| „Das Setup-Token ist abgelaufen." | 401 | Mehr als 30 Minuten seit dem Start | `docker compose restart panary-edge` — beim Start steht ein neues Token im Log |
| „Dieses Setup-Token wurde bereits verwendet." | 409 | Die Einrichtung ist schon gelaufen | Prüfen, ob der Edge bereits im Produktivmodus läuft (`curl http://<ip>:3030/health`) |
| „Zu viele Fehlversuche." | 429 | 10 Fehlversuche in 60 Sekunden von derselben IP | Eine Minute warten |

⚠️ **Ein abgelaufenes Token wird nur durch einen Container-Neustart erneuert.** Einen
Endpunkt zum Nachfordern gibt es bewusst nicht — er wäre selbst wieder offen erreichbar und
damit genau die Lücke, die das Token schließt.

## Was das Token nicht leistet

- **Gegen jemanden mit Host-Zugriff schützt es nicht.** Wer `docker logs` lesen oder `data/`
  betreten kann, hat das Token — und könnte den Container ohnehin ersetzen.
- **Der Edge spricht im LAN kein TLS** ([ADR 0023](../adr/0023-zugewiesene-pos-geraete.md) §5).
  Das Token geht im Klartext über das Netz. Es hebt die Hürde von „jeder, der die IP kennt"
  auf „jeder, der mitschneiden kann" — gegen einen Mitleser im selben Netz hilft es nicht.

## Angrenzend

- Der Edge ist im LAN weiterhin per mDNS (`_panary._tcp`) auffindbar, auch im Setup-Modus —
  sonst zeigte der POS-Wizard einen frischen Hub gar nicht erst an. Begründung und die
  entfallene `version`-Angabe: [ADR 0041](../adr/0041-setup-zugang-per-einmal-token.md).
- Startet der Container gar nicht erst, liegt es meist am fehlenden `FEATHERS_SECRET`:
  [Edge startet nicht](../infrastructure/edge-feathers-secret-pflicht.md).
