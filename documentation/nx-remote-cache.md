---
title: Nx Self-Hosted Remote Cache — Server, Sicherheit & Setup
date: 2026-06-18
category: Infrastruktur
domains: [ci, infra]
status: aktiv (Deploy ausstehend)
---

# Nx Self-Hosted Remote Cache

Geteilter Remote-Cache für **panary-core** und **panary-cloud**, gehostet auf
eigener Infra (Coolify + MinIO/Ugreen-S3). Beschleunigt die CI, indem
`nx affected`-Task-Ergebnisse (lint/test/build/typecheck) über Runs und Branches
hinweg wiederverwendet werden, statt sie auf jedem Runner neu zu rechnen.

## Scope-Ehrlichkeit — was der Cache (nicht) beschleunigt

- **Beschleunigt:** die `ci.yml`-Jobs (`pnpm nx affected -t lint,test,build`).
  Der größte Effekt entsteht über main-Pushes hinweg und — falls Read-Only-Token
  für PRs aktiviert wird — auch PR-Builds.
- **Beschleunigt NICHT (out of the box):** die Docker-Image-Builds
  (`build-and-push*.yml`, `build-edge-docker.yml`). Die führen `nx build`
  **innerhalb** des Containers aus; der dortige Build sieht den Remote-Cache nur,
  wenn man die Env-Vars als BuildKit-Secrets in den Build durchreicht (bewusst
  nicht gemacht — Token-im-Build-Risiko). Diese Builds profitieren stattdessen
  vom **Docker-Registry-Layer-Cache** (QW1/QW2). Beide Caches sind komplementär.

## ⚠️ Sicherheit zuerst — warum NICHT `@nx/s3-cache`

Die früheren Bucket-Cache-Pakete (`@nx/s3-cache`, `@nx/gcs-cache`, …) sind seit
**2026-05-21 deprecated** und von **CVE-2025-36852 („CREEP")** betroffen: ein
einzelnes Credential mit Schreibrechten über den ganzen Bucket, keine
Branch-Zuordnung der Artefakte → ein PR kann den Produktions-Cache vergiften.
**Nicht verwenden.** Wir nehmen stattdessen einen OpenAPI-Cache-Server (Nx ≥ 20.8)
plus CI-seitiges Token-Scoping.

**Zwei Schutzschichten gegen Cache-Poisoning:**

1. **CI-seitig (umgesetzt, siehe `ci.yml`):** Nur vertrauenswürdige
   **`push`-Events auf `main`** bekommen den **Read-Write-Token**. Pull Requests
   bekommen höchstens einen **Read-Only-Token**; ist keiner gesetzt, bleibt der
   Server für PRs ungesetzt → PRs nutzen nur den lokalen Cache und können den
   Remote-Cache weder lesen noch schreiben.
2. **Server-seitig (beim Deploy sicherstellen):** Der Server sollte **write-once**
   sein, also **`409 Conflict`** zurückgeben, wenn ein Cache-Key schon existiert
   (verhindert Überschreiben). Die aktuelle OpenAPI-Spec verlangt das.

## Server-Wahl

Nx liefert **kein** offizielles Image. Geprüfte Community-Implementierungen
(Stand 2026-06-18):

| Server | Sprache | S3/MinIO | 409 write-once | Tokens |
|---|---|---|---|---|
| **nxcite/nx-cache-server** (Empfehlung) | Rust | ✅ (`S3_ENDPOINT_URL`) | gegen die genutzte Version verifizieren | 1 Token (`SERVICE_ACCESS_TOKEN`) |
| IKatsuba/nx-cache-server | TS/Node | ✅ (`S3_ENDPOINT_URL`) | nicht dokumentiert | 1 Token (`NX_CACHE_ACCESS_TOKEN`) |
| enxtur/nx-caching-server | Go | ❌ (nur lokales FS) | ✅ | 1 Token (`AUTH_TOKEN`) |

**Empfehlung: `nxcite/nx-cache-server`** — Rust, S3/MinIO-fähig, aktiv gepflegt
(v1.3.0 vom 2026-06-15), beansprucht volle OpenAPI-Konformität (→ 409 sollte
enthalten sein; vor Go-Live testen, siehe unten). Keiner der Server bietet
server-seitige RO/RW-Token-Trennung — deshalb wird die Trennung CI-seitig über
zwei Tokens gelöst (Schicht 1 oben).

> **Wichtig:** nxcite liefert **kein Docker-Image**, nur ein Rust-Binary aus den
> GitHub-Releases. Wir bauen daher ein schlankes Wrapper-Image, das das auf
> **Version + SHA-256 gepinnte** Binary lädt (verifiziert gegen die `checksums.txt`
> — gleiche Supply-Chain-Hygiene wie QW5). Fertig im Repo:
> [`tools/nx-cache/Dockerfile`](../tools/nx-cache/Dockerfile) (v1.3.0,
> linux-x86_64, SHA-256 `65c8b504…ba080c`, verifiziert 2026-06-18).

## Deployment (Coolify)

Coolify-Service aus dem Wrapper-Dockerfile `tools/nx-cache/Dockerfile` bauen
(Version/SHA-256 dort gepinnt). **Secrets als Coolify-Env, NICHT via BWS:** ein
BWS-Machine-Account ist projekt-weit — gäbe man dem fremdentwickelten Cache einen
BWS-Token auf das bestehende Projekt, könnte er theoretisch *alle* Secrets lesen
(api-cloud-JWT, DB-Creds …). Echte Isolation bräuchte ein eigenes BWS-Projekt +
Machine-Account, also mehr Aufwand als Coolify-Env bei gleichem Ergebnis. Coolify
verschlüsselt seine Env-Vars at-rest und scoped sie auf genau diesen Service.

Coolify-Env (Werte an die nxcite-README angelehnt):

```
# S3-Backend = vorhandenes Ugreen-/MinIO-S3 (eigener Bucket!)
S3_ENDPOINT_URL   = https://nas.faberandcode.com:9000
S3_BUCKET_NAME    = panary-nx-cache        # NEU anlegen, NICHT der Backup-Bucket
AWS_ACCESS_KEY_ID = <S3-Key>
AWS_SECRET_ACCESS_KEY = <S3-Secret>
AWS_REGION        = us-east-1              # von MinIO ignoriert, aber gefordert

# Auth-Token (Bearer) — siehe Token-Modell unten
SERVICE_ACCESS_TOKEN = <langer Zufallswert>
```

- **Eigener Bucket** `panary-nx-cache`, getrennt vom Backup-Bucket.
- Server nur intern erreichbar machen (Coolify-internes Netz / kein öffentliches
  Ingress nötig) — GitHub-Runner erreichen ihn über die öffentliche URL nur,
  wenn nötig; sonst self-hosted Runner. Bei öffentlichem Endpoint: TLS + langer
  Token.
- **Write-once verifizieren:** zweimal denselben Key `PUT`en → der zweite Call
  muss `409` liefern.

## GitHub-Secrets (in BEIDEN Repos setzen)

| Secret | Zweck | Pflicht |
|---|---|---|
| `NX_CACHE_SERVER_URL` | URL des Cache-Servers (z. B. `https://nx-cache.panary.io`) | ja |
| `NX_CACHE_RW_TOKEN` | Read-Write-Token — wird nur auf `push:main` verwendet | ja |
| `NX_CACHE_RO_TOKEN` | Read-Only-Token — für PR-Builds (optional) | optional |

**Token-Modell je nach Server:**

- **Single-Token-Server (nxcite/IKatsuba):** Nur `NX_CACHE_RW_TOKEN` setzen,
  `NX_CACHE_RO_TOKEN` leer lassen. → main-Pushes füllen den Cache, PRs nutzen nur
  den lokalen Cache (sicher, aber PRs profitieren nicht vom Remote-Cache).
- **PR-Read-Caching aktivieren (mehr Speed):** einen echten Read-Only-Token
  ausstellen (Server muss das unterstützen) und als `NX_CACHE_RO_TOKEN` setzen.
  Dann lesen PRs den Cache, schreiben aber nicht. Ohne server-seitige
  RO-Durchsetzung NICHT denselben RW-Token als RO setzen — das öffnet den
  Poisoning-Vektor wieder.

## CI-Verdrahtung (bereits committet)

In `ci.yml` beider Repos (Job-Env):

```yaml
NX_SELF_HOSTED_REMOTE_CACHE_SERVER: ${{ (github.event_name == 'push' || secrets.NX_CACHE_RO_TOKEN != '') && secrets.NX_CACHE_SERVER_URL || '' }}
NX_SELF_HOSTED_REMOTE_CACHE_ACCESS_TOKEN: ${{ github.event_name == 'push' && secrets.NX_CACHE_RW_TOKEN || secrets.NX_CACHE_RO_TOKEN }}
```

Solange die Secrets fehlen, sind beide Werte leer → Nx ignoriert den
Remote-Cache. Es ist also kein CI-Bruch, bevor der Server steht. `nx.json` braucht
keine Änderung (der Env-Var-Mechanismus ist in Nx ≥ 20.8 eingebaut; die
`cache: true`-targetDefaults sind bereits gesetzt).

## Resilienz — ein Cache-Ausfall bricht die CI nicht (2026-06-19)

Der `affected`-Step in beiden `ci.yml` ist gegen Remote-Cache-Fehler abgesichert:
schlägt `nx affected` fehl **und** nennt die Ausgabe einen Remote-Cache-Fehler
(z. B. `Misconfigured remote cache endpoint: … 500`), wird der Lauf **einmal ohne
Remote-Cache** wiederholt (`NX_SELF_HOSTED_REMOTE_CACHE_SERVER=''` inline) →
Fallback auf den lokalen Cache. Echte Lint/Test/Build-Fehler ohne Cache-Bezug
brechen weiterhin **sofort** ab (kein Doppellauf — der erste Versuch bricht bei
einem Cache-Fehler bereits in der Cache-Init-Phase ab, vor den Tasks). Damit gilt
die Absicht „der Remote-Cache ist ein optionaler Beschleuniger" auch dann, wenn
der Server bereits konfiguriert, aber (noch) ungesund ist — eine Server-5xx-Phase
macht die CI nicht mehr rot, sondern nur langsamer + erzeugt eine GH-`warning`.

> **Hintergrund + Root-Cause (2026-06-19):** Beim ersten Live-Test lief `nx affected`
> in **panary-core** reproduzierbar in `500` (Nx: „Misconfigured remote cache
> endpoint"). Die **Server-Logs** zeigten die Ursache: **`NoSuchBucket` — der
> S3-Bucket `panary-nx-cache` war nie angelegt** (Deploy-Schritt aus dem
> Deployment-Abschnitt übersehen). Jeder Cache-`get_object` → `NoSuchBucket` →
> `500`. **panary-cloud** wirkte grün, weil dessen `nx affected
--base=remotes/origin/main` auf dem frischen Push einen ~leeren Affected-Satz
> hatte und den Cache gar nicht ansprach — **nicht** weil seine Secrets „richtiger"
> waren (die Secrets waren nie die Ursache; ein Secret-Reset blieb folgenlos).
> **Fix: Bucket anlegen.** Dieser Wrapper ist davon unabhängig die CI-seitige
> Absicherung gegen jede künftige Cache-Störung (Bucket/S3 weg, Server-5xx, Token).
>
> **Troubleshooting-Merksatz:** Nx-`500`/„Misconfigured remote cache endpoint" →
> zuerst die **Cache-Server-Logs** lesen (Coolify). `NoSuchBucket` = Bucket fehlt;
> `AccessDenied` = S3-Creds/Region falsch; `401` vor dem Server = Token/URL.

## Verifikation nach dem Deploy

1. Secrets in beiden Repos setzen.
2. Zweimal nach `main` pushen (kleine No-op-Änderung beim zweiten Mal).
3. Im zweiten Run-Log nach Cache-Treffern suchen — Nx meldet wiederverwendete
   Task-Outputs (z. B. „Nx read the output from the remote cache" /
   „existing outputs match the cache").
4. Im S3-Bucket `panary-nx-cache` liegen Objekte.

## Offene/optionale Folgeschritte

- **PR-Read-Caching** über echten RO-Token (Server-Support vorausgesetzt).
- **Nx-Cache in die Docker-Image-Builds** durchreichen (Env als BuildKit-Secret)
  — nur wenn der Zusatznutzen die Token-im-Build-Komplexität rechtfertigt.
- Nx-Cloud-Reste in `panary-cloud/ci.yml` (`nx record`, `nx fix-ci`,
  `start-ci-run`) sind Nx-**Cloud**-spezifisch und für den self-hosted Cache
  No-ops — bei Gelegenheit entfernen.
