---
type: ADR
title: Android-Wrapper per Capacitor mit http-Scheme und nativem HTTP-Layer
description: Warum die POS auf Sunmi-Android-Kassen als Capacitor-App mit WebView-Origin http://localhost, erlaubtem Klartext-Verkehr und CapacitorHttp läuft und was das kostet.
tags: [pos, devices, security]
status: stable
decision: accepted
generated: { by: claude-code/sonnet-5.5, at: 2026-10-21T19:00:00Z }
---

# Android-Wrapper per Capacitor mit http-Scheme und nativem HTTP-Layer

## Problem

Die POS (`apps/pos-client`) läuft als Web-App und als Tauri-Desktop-App. Für Sunmi-Android-Kassen
braucht es eine installierbare App ([#818](https://github.com/panary/panary-core/issues/818)). Sie muss
gegen drei Backends koppeln: Cloud (Produktion, Staging) und einen Edge im LAN
(`http://<ip>:3030`, ohne TLS). Eine WebView mit `https://localhost`-Origin dürfte den HTTP-Edge nicht
aufrufen (Mixed Content), und die Cloud lässt per CORS nur ihre Allowlist (`CLOUD_ORIGINS`) zu.

## Entscheidung

- Capacitor 8 als Hülle (Entscheidung der Strategie, `docs/architecture/mobile-pos-strategie.md`).
- `server.androidScheme: 'http'`: die WebView-Origin ist `http://localhost`, Aufrufe an den HTTP-Edge sind
  kein Mixed Content.
- `android:usesCleartextTraffic="true"` im Manifest, weil der Edge im LAN kein TLS spricht.
- `plugins.CapacitorHttp.enabled`: `fetch`/XHR laufen nativ, die CORS-Prüfung der Cloud greift nicht;
  `CLOUD_ORIGINS` bleibt unverändert.
- `allowBackup="false"`: Gerätekonfiguration und Token landen nicht in Android-Backups.

## Konsequenzen

- Die Origin ist kein Secure Context: kein `crypto.subtle`, `getUserMedia`, `BarcodeDetector`. Gekoppelt wird
  nur per Code; Admin-Login-Fallback (ALTCHA) und QR-Scan entfallen auf Android.
- Klartext-HTTP ist für die ganze App erlaubt, nicht nur für den Edge. Der Verkehr zur Cloud läuft weiter
  über HTTPS, weil die konfigurierten Cloud-URLs `https` tragen.
- Der dauerhaft saubere Weg wäre ein Origin-Eintrag in der Cloud-Allowlist (eigenes Issue in panary-cloud);
  `https` am Edge würde `androidScheme: 'https'` erlauben.
- Hardware (Drucker, Kassenlade, NFC), Release-Signierung und Store-Auslieferung sind nicht Teil dieser Entscheidung.
