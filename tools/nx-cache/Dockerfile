# check=skip=FromPlatformFlagConstDisallowed
# (Single-Target-Infra-Image: das amd64-Binary erzwingt bewusst eine amd64-Base —
#  die generische Multi-Platform-Lint-Regel ist hier nicht anwendbar.)
# ============================================================
# Nx Self-Hosted Remote Cache (nxcite/nx-cache-server) — Wrapper-Image
# ============================================================
# nxcite liefert KEIN Docker-Image, nur ein Rust-Binary aus den GitHub
# Releases. Dieses schlanke Image laedt das auf Version + SHA-256 gepinnte
# Binary (verifiziert gegen die veroeffentlichte checksums.txt) und startet es.
#
# Deploy: Coolify-Service aus diesem Dockerfile. Secrets als Coolify-Env
# (NICHT via BWS — der fremdentwickelte Cache soll keinen projekt-weiten
# BWS-Machine-Token bekommen; least privilege). Vollstaendiges Runbook:
# ../../documentation/nx-remote-cache.md
#
# Build (amd64 — eure Coolify-Hosts):
#   docker build -t panary-nx-cache:v1.3.0 tools/nx-cache
# ============================================================
# --platform=linux/amd64: das Binary ist linux-x86_64 — die Base MUSS dieselbe
# Arch sein. Erzwingt ein amd64-Image auch beim Build auf einem arm64-Rechner
# (z.B. Apple Silicon); passt zu den amd64-Coolify-Hosts.
FROM --platform=linux/amd64 debian:bookworm-slim

# ca-certificates: HTTPS zum MinIO/S3-Endpoint. curl: Download + Healthcheck.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates curl \
 && rm -rf /var/lib/apt/lists/*

# Supply-Chain: Version + SHA-256 gepinnt (verifiziert am 2026-06-18 gegen die
# Release-checksums.txt). Neue Version: beide ARGs bumpen + SHA neu verifizieren.
ARG NX_CACHE_VERSION=v1.3.0
ARG NX_CACHE_SHA256=65c8b504ede5ebe99d07311ab217545875c9d452c4ad1edbe90a8d3296ba080c

RUN curl -fsSL -o /usr/local/bin/nx-cache-aws \
      "https://github.com/nxcite/nx-cache-server/releases/download/${NX_CACHE_VERSION}/nx-cache-aws-${NX_CACHE_VERSION}-linux-x86_64" \
 && echo "${NX_CACHE_SHA256}  /usr/local/bin/nx-cache-aws" | sha256sum -c - \
 && chmod +x /usr/local/bin/nx-cache-aws

# Non-root (Container-Escape-Haertung, wie die uebrigen Images).
USER nobody

# Server-Defaults. Secrets/Config kommen via Coolify-Env:
#   S3_BUCKET_NAME, S3_ENDPOINT_URL, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY,
#   AWS_REGION, SERVICE_ACCESS_TOKEN
ENV PORT=3000 \
    BIND_ADDRESS=0.0.0.0
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["/usr/local/bin/nx-cache-aws"]
