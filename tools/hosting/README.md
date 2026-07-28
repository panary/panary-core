# Installer-Hosting

## `get.panary.cloud/`

Inhalt dieses Ordners wird **1:1 in den Bunny-Storage-Zone-Root** geladen und
über die Pull Zone unter `https://get.panary.cloud` ausgeliefert:

| Datei        | Zweck                                                 |
| ------------ | ----------------------------------------------------- |
| `install.sh` | Edge-Installationsskript (`curl -sL … \| sudo bash`)  |
| `index.html` | Landingpage mit dem Installationsbefehl + Copy-Button |

**Nur diese beiden Dateien.** Alles, was hier liegt, ist über die Pull Zone
öffentlich abrufbar — also keine Konfigurationsdateien, keine Notizen, keine
`.htaccess` (die wäre auf Bunny ohnehin wirkungslos und unter
`https://get.panary.cloud/.htaccess` lesbar).

### Pull-Zone-Anforderungen

Was früher die `.htaccess` des Strato-Webspace geregelt hat, muss in der
Bunny-Pull-Zone konfiguriert sein:

1. **`.sh` als `text/plain` ausliefern** — sonst lädt der Browser das Skript
   herunter statt es anzuzeigen.
2. **`index.html` als Directory-Index** — `https://get.panary.cloud` ohne Pfad
   soll die Landingpage zeigen.
3. **Kein Directory-Listing.**

### DNS

`get.panary.cloud` braucht einen **expliziten CNAME** auf die Pull Zone. Ohne
den fängt der Storefront-Wildcard `*.panary.cloud` den Namen ab und liefert
einen 404 aus der Storefront-Zone.

## Alte Adresse

`get.panary.io` (Strato) ist seit 2026-07-28 **abgeschaltet — ohne Redirect**.
Alt-Anleitungen, Kundenmails und Screenshots mit dieser Adresse schlagen fehl
und müssen nachgezogen werden. Im Repo gibt es keine Vorkommen mehr; der
Alt-Host lief zudem ohne funktionierendes HTTPS, die dokumentierte Installation
also per `curl … | sudo bash` über HTTP.
