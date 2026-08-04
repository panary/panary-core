# Integrationen

Externe Integrationen — APIs, Provider, Protokolle, Fehlerbehandlung
(`type: Architecture` oder `Reference`).

* [Print-Server-API](print-server-api.md) - Referenz der Print-Server-Schnittstelle am Edge — Aufrufer, Ziel-Host und Fehler-Events sowie die ESC/POS-Encoder-Library mit Fonts, Größen, Stilen, Befehlen und Konfiguration.
* [Tauri Update-Server-Einrichtung](tauri-update-server-einrichtung.md) - Einrichtung des Tauri-Auto-Update-Systems: Ed25519-Signatur-Schlüsselpaar, GitHub-Actions-Release-Workflow mit latest.json und Update-Prüfung samt Installation in der POS-App.
* [TSE-Port + Simulator (KassenSichV-Fiskalisierung)](tse-integration.md) - Provider-agnostischer TsePort mit deterministischem Simulator-Adapter samt Fault-Injection für den KassenSichV-Ausfallpfad und fail-closed Provider-Auflösung im Bootstrap.
