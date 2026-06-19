---
title: Nx Self-Hosted Remote Cache — Server, Sicherheit & Setup
date: 2026-06-18
category: Infrastruktur
domains: [ci, infra]
status: aktiv (in Betrieb seit 2026-06-19)
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
> zuerst die **Cache-Server-Logs** lesen (Coolify). Bisher gesehene Ursachen:
> `NoSuchBucket` = Bucket fehlt/Name-Mismatch; `Http2 … GoAway(NO_ERROR, Remote)`
> auf `get_object`/`put_object` = HTTP/2 am Reverse-Proxy (→ Abschnitt
> „HTTP/2-GOAWAY"); `AccessDenied` = S3-Creds/Region; `401` **vor** dem Server =
> Token/URL.

## HTTP/2-GOAWAY am Reverse-Proxy (gelöst 2026-06-19)

Nachdem der Bucket existierte, kamen unter **Burst-Last** (viele Cache-Ops pro
Lauf, v.a. parallele core+cloud-Builds) weiterhin **sporadische `500`**. Die
nxcite-Logs zeigten **keinen** Storage-Fehler, sondern Transport:
`S3 get_object failed: … hyper::Error(Http2, GoAway(NO_ERROR, Remote))`.

**Ursache:** `s3.ratke.info` läuft hinter **Nginx Proxy Manager** (SSL-Terminierung,
forward `http://192.168.178.50:8333` = SeaweedFS S3) mit **„HTTP/2 Support" AN**.
nginx recycelt HTTP/2-Verbindungen nach `keepalive_requests` (Default 1000) und
schickt ein `GOAWAY`; der AWS-Rust-SDK-Client in nxcite poolt die HTTP/2-
Verbindung und wiederholt den mittendrin abgebrochenen Request **nicht** → `500`.
Intermittierend, weil das GOAWAY erst nach genug Requests auf derselben
Connection kommt (deshalb laufen Einzel-Läufe sauber, Bursts kippen).

**Fix (1 Toggle):** NPM → `s3.ratke.info` → SSL → **„HTTP/2 Support" AUS**. Eine
S3-API (Maschine-zu-Maschine, Request/Response) profitiert nicht von HTTP/2;
HTTP/1.1-Keep-Alive hat kein „GOAWAY-mid-request". **Verifiziert 2026-06-19:**
core+cloud **gleichzeitig** → 0× GOAWAY/500, `[remote cache]`-Reads sauber.
SeaweedFS selbst war durchgehend gesund (Volumes für `nx-cache-server` angelegt,
Writes landen). Hinweis: NPMs „Block Common Exploits" ist für eine S3-API
potenziell heikel — falls nach dem HTTP/2-Fix vereinzelt `403` (statt `500`)
auftauchen, dort als Nächstes prüfen.

## Hebel 2 (Nx-Cache in die Docker-Image-Builds) — geprüft & verworfen (2026-06-19)

Versucht: `NX_SELF_HOSTED_REMOTE_CACHE_*` via BuildKit-Secret (kein build-arg →
kein Layer-Leak) in den `nx build`-Step des admin-dashboard-Image, mit
Cache-Fehler-Fallback. **Wieder revertiert**, weil der Live-Test zeigte:

- **Unveränderte App:** Der `nx build`-RUN-Layer wird bereits vom
  **Docker-Registry-Layer-Cache** (`buildcache-staging`) bedient — Layer `CACHED`,
  ~9 s, `nx build` läuft gar nicht → der Nx-Remote-Cache wird nie erreicht,
  **redundant**.
- **Geänderte App** (= der eigentliche 20-Min-Fall): `nx build` muss laufen, aber
  der Nx-Cache **misst** (neue Quelle = neuer Hash) → **kein Nutzen**.
- Einzige reale Nische: Cross-Pipeline-Sharing desselben Commits (ein
  Prod-Release-Build zieht den `build:production`, den ein Staging-Build desselben
  Commits gecacht hat — die per-Tag-Layer-Caches teilen das nicht, der Nx-Cache
  schon). Zu speziell für die Komplexität + die zusätzliche Cache-Server-Exposure
  im Image-Build.

**Fazit:** Der Nx-Remote-Cache lohnt sich für die **`ci.yml`-Validierungsjobs**
(lint/test/build über Läufe), **nicht** für die Docker-Image-Builds. Der echte
Hebel gegen langsame (geänderte-Quelle-)Image-Builds ist **Runner-Kapazität**
(self-hosted Runner — geplant) und **Build-Scope** (z.B. zieht das
storefront-`--legacy deploy` den ganzen Workspace, ~0.9 GB).

## Verifikation nach dem Deploy

1. Secrets in beiden Repos setzen.
2. Zweimal nach `main` pushen (kleine No-op-Änderung beim zweiten Mal).
3. Im zweiten Run-Log nach Cache-Treffern suchen — Nx meldet wiederverwendete
   Task-Outputs (z. B. „Nx read the output from the remote cache" /
   „existing outputs match the cache").
4. Im S3-Bucket `panary-nx-cache` liegen Objekte.

## Offene/optionale Folgeschritte

- **PR-Read-Caching** über echten RO-Token (Server-Support vorausgesetzt).
- ~~**Nx-Cache in die Docker-Image-Builds** durchreichen~~ — **2026-06-19 geprüft
  & verworfen** (Docker-Layer-Cache schattet ihn; kein Nutzen bei geänderter
  Quelle). Details: Abschnitt „Hebel 2 … geprüft & verworfen". Stattdessen:
  self-hosted Runner + Build-Scope.
- Nx-Cloud-Reste in `panary-cloud/ci.yml` (`nx record`, `nx fix-ci`,
  `start-ci-run`) sind Nx-**Cloud**-spezifisch und für den self-hosted Cache
  No-ops — bei Gelegenheit entfernen.
