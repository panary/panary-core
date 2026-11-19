---
type: Guide
title: Edge ohne Token-Schlüssel — EDGE_TOKEN_ENCRYPTION_KEY auf jede Edge bringen
description: Der Edge verschlüsselt den Cloud-Token in SQLite nur mit EDGE_TOKEN_ENCRYPTION_KEY; dieser Guide nennt, wie der Installer den Schlüssel erzeugt, was der Boot-Lauf nachverschlüsselt und meldet, und wie eine Feld-Edge ohne Installer-Lauf zu einem Schlüssel kommt.
tags: [api-edge, security, boot, infra, deployment, cloud-connection]
status: stable
generated: { by: claude-code/sonnet-5.5, at: 2026-11-19T22:30:00.000Z }
sources:
  - { id: issue-1498, resource: 'https://github.com/panary/panary-core/issues/1498', title: 'Edge-Token-Schlüssel auf jede Edge bringen (Teil A)' }
  - { id: issue-1499, resource: 'https://github.com/panary/panary-core/issues/1499', title: 'Edge-Token-Schlüssel erzwingen (Teil B)' }
  - { id: install-sh, resource: tools/hosting/get.panary.cloud/install.sh, title: Edge-Installationsskript }
  - { id: boot-migration, resource: apps/api-edge/src/utils/cloud-token-boot-migration.ts, title: Boot-Lauf für den cloudToken }
  - { id: cipher, resource: apps/api-edge/src/utils/cloud-token-cipher.ts, title: AES-256-GCM-Cipher für den cloudToken }
---

# Edge ohne Token-Schlüssel — `EDGE_TOKEN_ENCRYPTION_KEY`

Schwester-Guide zu [Edge startet nicht — `FEATHERS_SECRET`](edge-feathers-secret-pflicht.md). Der
Unterschied ist der Kern: **Der Edge startet auch ohne diesen Schlüssel.** Er warnt nur — das
Erzwingen ist Teil B ([#1499](https://github.com/panary/panary-core/issues/1499)).

## Was der Schlüssel schützt

`cloud-connection.cloudToken` ist das Zugangstoken des Edge zur Cloud. Mit gesetztem Schlüssel liegt es als
`enc:v1:<iv>:<ciphertext>:<tag>` (AES-256-GCM) in SQLite, ohne Schlüssel im Klartext. Der Schlüssel schützt
damit gegen den Abfluss von Datenbank oder Backup, **nicht** gegen Zugriff auf das laufende Gerät: Er liegt
als Klartext in der `.env` neben der Compose-Datei. Das ist eine Zwischenstufe bis zum OS-Keystore
([#413](https://github.com/panary/panary-core/issues/413)). Hintergrund: ADR 0109 in panary/panary-cloud.

## Wie der Schlüssel auf die Edge kommt

| Weg | Verhalten |
| --- | --- |
| Erstinstallation per `install.sh` | erzeugt `openssl rand -base64 32` (44 Zeichen), schreibt ihn in die `.env` **und** reicht ihn im Compose-Dienst `panary-edge` durch |
| Erneuter Installer-Lauf, `.env` ohne Schlüssel | erzeugt ihn nach, schreibt Compose neu, `docker compose up -d` startet den Container mit Schlüssel |
| Erneuter Installer-Lauf, `.env` mit Schlüssel | **ersetzt ihn nie** — auch nicht, wenn er kürzer als 32 Zeichen ist (dann nur ein Hinweis) |
| `tools/docker/docker-compose.edge.yml` und `…edge.dev.yml` | verlangen `FEATHERS_SECRET` und `EDGE_TOKEN_ENCRYPTION_KEY` aus Shell oder `.env` (`${…:?}`); kein fester Wert im Repo |
| Watchtower-Update ohne Installer-Lauf | **bringt keinen Schlüssel** — Watchtower tauscht nur das Image, `.env` und Compose bleiben unberührt |

🚨 **Ein neuer Schlüssel zerstört Daten**, anders als beim `FEATHERS_SECRET`: Der bereits verschlüsselte Token
wäre unlesbar, der Edge müsste neu gekoppelt werden. Deshalb ersetzt der Installer einen vorhandenen Wert nie
und erzeugt nur, wenn gar keiner da ist. Der Schlüssel gehört in jedes Backup der `.env`.

## Was der Edge beim Boot tut

`apps/api-edge/src/utils/cloud-token-boot-migration.ts` läuft einmal je Boot, **vor** Bootstrap-Resume und
Sync-Scheduler (sonst könnte die Token-Rotation des Heartbeats einen frischen Token mit dem hier gelesenen
alten überschreiben). Er wirft nie; Schlüssel und Token stehen nie im Log.

| Zustand | Ergebnis | Log-Event |
| --- | --- | --- |
| Klartext-Token, Schlüssel gesetzt | wird verschlüsselt zurückgeschrieben | `bootstrap.token_encrypted` (info) |
| Verschlüsselter Token, Schlüssel passt | Probe-Entschlüsselung, keine Änderung | — |
| Verschlüsselter Token, **falscher** Schlüssel | **kein** Klartext-Fallback, nichts verändert | `bootstrap.token_key_mismatch` (error) |
| Verschlüsselter Token, Schlüssel **fehlt** | wie oben; der Edge erreicht die Cloud nicht | `bootstrap.token_key_mismatch` (error) |
| Klartext-Token, Schlüssel fehlt | bleibt Klartext | `bootstrap.token_key_missing` (warn) |
| Schlüssel mit 8–31 Zeichen | wird benutzt, nicht ersetzt | `bootstrap.token_key_weak` (warn) |

```bash
docker logs panary-edge 2>&1 | grep -E 'token_key_(missing|mismatch|weak)|token_encrypted'
```

## Behebung

**Schlüssel fehlt** (Warnung `bootstrap.token_key_missing`): Installer erneut ausführen. Er ist idempotent,
erzeugt den Schlüssel nach und startet den Container neu; der nächste Boot verschlüsselt den Token.

```bash
curl -fsSL https://get.panary.cloud | sudo bash
```

**Falscher Schlüssel** (Fehler `bootstrap.token_key_mismatch`): den **ursprünglichen** Schlüssel aus einem
Backup der `.env` wieder eintragen und `docker compose up -d` ausführen. Ist er verloren, hilft nur ein
Re-Pairing der Edge — der verschlüsselte Token ist ohne ihn nicht zu retten.

## Feld-Edges ohne Installer-Lauf — Entscheidung für Teil B

Edges, die seit dem Update nur per Watchtower laufen, haben **keinen** Schlüssel und bekommen keinen, solange
niemand den Installer ausführt. Teil A löst das nicht, es macht es sichtbar: ab diesem Stand steht beim Boot
eine laute Warnung mit dem Behebungsweg im Container-Log. Wie Teil B damit umgeht, entscheidet Michael vor dem
Erzwingen; die Optionen und die Empfehlung stehen im Kommentar zu
[#1498](https://github.com/panary/panary-core/issues/1498). Ein erzwingender Guard im selben Release wie Teil A
wäre ein Kassenausfall auf jeder Feld-Edge ohne neuen Installer-Lauf gewesen.

## Nicht abgedeckt

- Backups von vor der Nachverschlüsselung enthalten den Klartext-Token weiter.
- Von Hand gepflegte `.env`-Dateien: Der Installer schreibt die `.env` bei jedem Lauf neu; Zeilen, die er
  nicht kennt, gehen dabei verloren (unverändert seit jeher).
- Die Live-Kopie von `install.sh` auf get.panary.cloud wird erst nach dem Merge nachgezogen
  (`scripts/installer-drift.spec.mjs` vergleicht sie mit dem Repo).
