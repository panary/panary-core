---
type: ADR
title: Setup-Zugang am Edge — Einmal-Token aus Log und Datei statt offenem Endpunkt
description: POST /api/setup verlangt ein Token, das der Edge beim Start des Setup-Modus würfelt und nur über Container-Log und eine 0600-Datei ausgibt; mDNS bleibt, weil Auffindbarkeit nach der Härtung kein Übernahmepfad mehr ist.
tags: [api-edge, setup-client, security, setup, mdns]
status: stable
decision: accepted
generated: { by: claude-code/opus-5, at: 2026-09-17T12:45:00.000Z }
---

# Setup-Zugang am Edge

## Problem

`POST /api/setup` war unauthentifiziert. Die einzige Prüfung war
`if (!config || typeof config !== 'object')`; wer den Edge im LAN erreichte, richtete ihn
ein — Admin-Konto, Cloud-Anbindung, Betriebsdaten. Es gab kein Rate-Limit, und der Edge
annoncierte sich im Setup-Modus per mDNS aktiv als `_panary._tcp` mit `setupComplete: false`,
machte den verwundbaren Zustand also auffindbar.

[ADR 0040](0040-edge-boot-haertung-secret-und-config-allowlist.md) hat dem Endpunkt bereits
den Generalschlüssel genommen (Config-Schlüssel landen nicht mehr ungefiltert in
`process.env`) und den Setup-Modus auf den Fall „keine Konfiguration vorhanden" verengt. Der
**Zugang** selbst blieb offen.

Die naheliegende Antwort — ein Login — gibt es hier nicht: Im Setup-Modus existiert noch kein
Benutzerkonto. Das Konto ist ja gerade das, was der Vorgang anlegt.

## Entscheidung

**Der Edge würfelt beim Start des Setup-Modus ein Token und gibt es nur dort aus, wo
Host-Zugriff nötig ist:** im Container-Log (als lesbarer Banner für `docker logs`) und in
`data/setup-token.txt` mit Modus `0600`. `POST /api/setup` verlangt es im Header
`X-Setup-Token`. Wer den Host erreicht, braucht den Setup-Endpunkt ohnehin nicht, um Schaden
anzurichten — das ist die organisatorische Grenze, an der der Schutz endet und auch enden soll.

| Eigenschaft | Wert | Grund |
| --- | --- | --- |
| Alphabet | Crockford-Base32 ohne `I`, `L`, `O`, `U` | Das Token wird vom Bildschirm abgetippt |
| Länge | 8 Zeichen (≈ 1,1 × 10¹²), Anzeige `XXXX-XXXX` | Abtippbar, mit Rate-Limit nicht durchprobierbar |
| Vergleich | normalisiert (Groß/Klein, Trenner egal), `timingSafeEqual` | Tippfehlertoleranz kostet keinen Suchraum |
| Frist | 30 Minuten ab Start des Setup-Modus | Deckt Wege, Rückfragen und Kaffee; erneuert per Container-Neustart |
| Verwendung | einmalig, entwertet **nach** dem Schreiben der Config | Ein an einem Schreibfehler verbrauchtes Token zwänge zum Neustart, obwohl nichts passiert ist |
| Rate-Limit | 10 Fehlversuche / 60 s je IP | Vorbild `device-pairing.ts` — der einzige Edge-Auth-Pfad, der das schon hatte |

**Das Token reist im Header, nicht im Body.** Der Body wird unverändert nach
`data/panary.config.json` geschrieben; ein Token im Body läge danach dauerhaft im Klartext
neben der Konfiguration.

**Das Rate-Limit greift vor dem Vergleich**, sonst wäre es eine Zählung des Durchprobierens
statt eines Schutzes davor. Umgekehrt zählt ein **abgelaufenes oder bereits verbrauchtes**
Token *nicht* als Fehlversuch: Das ist kein Rateversuch, sondern ein Betreiber mit einem alten
Zettel — ihn nach zehn Versuchen auch noch auszusperren, hilft niemandem.

**Ablehnungen antworten sprechend** (`401` fehlend/falsch/abgelaufen, `409` verbraucht,
`429` Limit) statt mit `500`, und der Setup-Client übersetzt sie in Klartext. Bisher stand
dort `alert('Setup failed: ' + err.message)` — bei abgelehntem Token also „Http failure
response for /api/setup: 401 Unauthorized", ohne jeden Hinweis auf das Log.

**`GET /api/system-info` bleibt offen.** Der Wizard braucht es, um den Hub überhaupt zu finden;
es gibt IP und Port preis, die im selben Netz ohnehin sichtbar sind.

**mDNS im Setup-Modus bleibt — mit einer Kürzung.** Die Annonce hat einen realen Zweck:
`setup.component.ts:409` schaltet bei `setupComplete === false` auf den Hinweis „zuerst
einrichten". Ohne sie taucht ein frischer Hub in der POS-Geräteliste gar nicht auf, und der
Nutzer sähe nicht, warum. Die Auffindbarkeit war ein Problem, solange sie zu einem
übernehmbaren Endpunkt führte; mit dem Token führt sie zu einer Tür, die verschlossen ist.
Entfallen ist nur das TXT-Feld `version` — es nennt einem Scanner die Angriffsfläche und hat
in diesem Zustand keinen Konsumenten (`hub-discovery.service.ts:187` mappt es, niemand liest
es).

## Konsequenzen

- **Die Erstinstallation braucht einen Blick ins Container-Log.** Das ist ein zusätzlicher
  Schritt für den legitimen Betreiber. Der Installer `get.panary.cloud/install.sh` endet
  ohnehin auf dem Host, auf dem das Log liegt; die Anleitung nennt den Befehl.
- **Ein abgelaufenes Token erzwingt einen Container-Neustart.** Bewusst kein Erneuerungs-
  Endpunkt: Der wäre selbst wieder unauthentifiziert erreichbar und damit genau das Loch,
  das dieser ADR schließt. `docker compose restart panary-edge` ist der dokumentierte Weg.
- **Backend und Setup-Client müssen zusammen ausgeliefert werden.** Ein Edge mit Token-Pflicht
  und einem Wizard ohne Token-Feld ist gehärtet, aber nicht bedienbar. Beide liegen im selben
  Image — die Kopplung ist gegeben, solange niemand den Client separat pinnt.
- **Der Guard ist In-Memory und prozessgebunden.** Der Edge im Setup-Modus ist ein einzelner
  Prozess; ein Neustart *soll* ein neues Token bedeuten. Für eine Mehr-Instanz-Aufstellung
  wäre das falsch — die gibt es am Edge nicht und ist auch nicht geplant.
- **Gegen einen Angreifer mit Host-Zugriff schützt nichts davon.** Wer das Log lesen oder
  `data/` betreten kann, hat das Token. Das ist die bewusste Grenze; wer so weit ist, kann
  ohnehin den Container ersetzen.
- **Der Edge läuft weiterhin ohne TLS im LAN** ([ADR 0023](0023-zugewiesene-pos-geraete.md) §5).
  Das Token geht im Klartext über das Netz und ist gegen jemanden, der mitliest, wertlos. Es
  hebt die Latte von „jeder, der die IP kennt" auf „jeder, der mitschneiden kann" — kein
  vollständiger Schutz, aber die Angreiferklasse ist eine andere. TLS am Edge ist ein eigenes,
  größeres Thema und Voraussetzung für einen zweiten Faktor.

## Alternativen

- **Physischer Knopf oder Datei-Touch (`data/setup-unlocked`).** Der Datei-Touch ist exakt
  derselbe Besitznachweis wie die Token-Datei, nur ohne Geheimnis — er verlangt einen zweiten
  Host-Zugriff *während* des Setups statt einmal davor, und ein vergessenes Entsperren sperrt
  den Betreiber aus. Ein physischer Knopf existiert auf der Zielhardware nicht verlässlich.
- **Bindung an die erste zugreifende IP.** Klingt bequem, weil der Betreiber nichts abtippen
  muss. In der Praxis belegt der erste Netzwerk-Scanner oder Monitoring-Ping die Bindung, und
  der Betreiber ist ausgesperrt, ohne zu verstehen warum.
- **mDNS im Setup-Modus abschalten.** Reduziert die Auffindbarkeit, nimmt dem POS-Wizard aber
  den einzigen Weg, einen frischen Hub anzuzeigen — der Nutzer stünde vor einer leeren Liste.
  Nach der Token-Härtung ist der Gewinn gering und der Verlust konkret.
