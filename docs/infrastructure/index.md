# Infrastruktur

CI, Docker, Deployment und Infra-Betrieb (`type: Guide` oder `Architecture`).

* [Docker-Build-Fix — Native Module für Cross-Platform-Deployment](docker-native-module-fix.md) - Docker-Build von api-edge nutzt durchgängig glibc-basierte bookworm-slim-Stages, damit native Module wie sqlite3 plattformübergreifend lauffähig sind.
* [Nx Self-Hosted Remote Cache — Server, Sicherheit & Setup](nx-remote-cache.md) - Geteilter Nx-Remote-Cache für core und cloud auf eigener Coolify/MinIO-Infra mit OpenAPI-Cache-Server und CI-seitigem Token-Scoping gegen Cache-Poisoning.
* [Self-hosted GitHub Actions Runner — Setup, Sicherheit & Betrieb](self-hosted-runner.md) - Setup, Sicherheit und Betrieb des geteilten Org-Level self-hosted GitHub-Actions-Runners für core und cloud auf dem Staging-Host als systemd-Dienst.
* [TypeScript-7-Migration — Status, Blocker & Vorbereitung](typescript-7-migration.md) - Status der TypeScript-7-Migration (GA 2026-07-08) mit den aktuellen Blockern durch die fehlende TS-API, der umgesetzten tsconfig-Vorbereitung und den Triggern für den Re-Check.
