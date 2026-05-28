# Standalone-TSE-Gateway (Simulator) — NICHT fiskalisch gültig, nur Test/Staging.
#
# Build (vom Workspace-Root) vorab:
#   pnpm nx build tse-gateway   →   dist/apps/tse-gateway/main.js (self-contained Bundle)
# Image bauen:
#   docker build -f apps/tse-gateway/Dockerfile -t panary-tse-gateway dist/apps/tse-gateway
FROM node:22-bookworm-slim
WORKDIR /app
COPY . ./
# Container laeuft als non-root (`node`-User aus dem Base-Image). Schuetzt
# vor Container-Escape-Eskalation; erfuellt Semgrep
# dockerfile.security.missing-user. /app gehoert nach COPY initial root —
# einmaliges chown gibt dem `node`-User Lesezugriff aufs Bundle.
RUN chown -R node:node /app
USER node
ENV TSE_GATEWAY_PORT=3040
EXPOSE 3040
CMD ["node", "main.js"]
