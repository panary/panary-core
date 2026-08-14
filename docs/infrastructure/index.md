# Infrastruktur

CI, Docker, Deployment und Infra-Betrieb (`type: Guide` oder `Architecture`).

* [Docker-Build-Fix — Native Module für Cross-Platform-Deployment](docker-native-module-fix.md) - Docker-Build von api-edge nutzt durchgängig glibc-basierte bookworm-slim-Stages, damit native Module wie sqlite3 plattformübergreifend lauffähig sind.
* [Edge-Installation — GHCR-Pull-Fehler „denied: denied"](edge-installation-ghcr-pull.md) - Der Installer bricht mit „denied: denied" ab, obwohl das Edge-Image öffentlich ist — Ursache sind abgelaufene lokale ghcr.io-Credentials, erkannt durch die Registry-Vorabprüfung in install.sh.
* [Nx-Typecheck-Target — warum es jahrelang ins Leere lief und was es jetzt hält](nx-typecheck-target.md) - Das typecheck-Target starb workspace-weit an der Konfiguration, bevor eine Datei geprüft wurde; seit der Reparatur ist es grün und läuft als hartes CI-Gate mit — api-edge fehlte bis 2026-08-14 ganz.
* [TypeScript-7-Migration — Status, Blocker & Vorbereitung](typescript-7-migration.md) - Status der TypeScript-7-Migration (GA 2026-07-08) mit den aktuellen Blockern durch die fehlende TS-API, der umgesetzten tsconfig-Vorbereitung und den Triggern für den Re-Check.
