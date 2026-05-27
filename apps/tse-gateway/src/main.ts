import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'

import { SimulatorTseAdapter, TseUnavailableError, type TseTransactionRef } from '@panary/tse/domain'

// Standalone-TSE-Gateway: kapselt den SimulatorTseAdapter über HTTP, damit
// Staging/E2E und mehrere Edges einen gemeinsamen, zustandsbehafteten Fake-TSE
// ansprechen (konsistenter Signatur-Zähler) und den echten Netzwerk-/Timeout-
// Pfad testen können. Der `/fault`-Endpoint schaltet Ausfall/Latenz für
// deterministische §146a-Tests. NICHT fiskalisch gültig — nur Test/Dev/Staging.

const PORT = Number(process.env['TSE_GATEWAY_PORT'] ?? 3040)

// Eine geteilte Instanz pro Prozess → konsistenter Signatur-Zähler über alle Clients.
const tse = new SimulatorTseAdapter()

const readJson = (req: IncomingMessage): Promise<Record<string, unknown>> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', c => chunks.push(c as Buffer))
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>)
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)))
      }
    })
    req.on('error', reject)
  })

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
  const method = req.method ?? 'GET'
  const url = (req.url ?? '/').split('?')[0]

  if (method === 'GET' && url === '/health') {
    send(res, 200, { status: 'ok', simulated: true })
    return
  }
  if (method === 'GET' && url === '/status') {
    send(res, 200, await tse.getStatus())
    return
  }

  if (method === 'POST') {
    const body = await readJson(req)
    switch (url) {
      case '/transactions':
        send(
          res,
          200,
          await tse.startTransaction({
            clientId: String(body['clientId'] ?? 'gateway'),
            transactionNumber: Number(body['transactionNumber'] ?? 0),
          }),
        )
        return
      case '/transactions/finish':
        send(
          res,
          200,
          await tse.finishTransaction(body['ref'] as unknown as TseTransactionRef, {
            amountCents: Number(body['amountCents'] ?? 0),
          }),
        )
        return
      case '/transactions/cancel':
        send(res, 200, await tse.cancelTransaction(body['ref'] as unknown as TseTransactionRef))
        return
      case '/day-close':
        send(
          res,
          200,
          await tse.signDayClose({
            businessDayId: String(body['businessDayId'] ?? ''),
            closedAt: String(body['closedAt'] ?? new Date().toISOString()),
          }),
        )
        return
      case '/export':
        send(res, 200, await tse.export({ from: String(body['from'] ?? ''), to: String(body['to'] ?? '') }))
        return
      case '/fault':
        tse.setFault({
          outage: Boolean(body['outage']),
          latencyMs: body['latencyMs'] != null ? Number(body['latencyMs']) : undefined,
        })
        send(res, 200, { ok: true })
        return
    }
  }

  send(res, 404, { error: 'not_found' })
}

const server = createServer((req, res) => {
  route(req, res).catch((err: unknown) => {
    if (err instanceof TseUnavailableError) {
      send(res, 503, { error: 'tse_unavailable', message: err.message })
      return
    }
    send(res, 500, { error: 'internal', message: err instanceof Error ? err.message : String(err) })
  })
})

server.listen(PORT, () => {
  // eslint-disable-next-line no-console -- Standalone-Dev-Tool ohne Winston-Logger
  console.log(`TSE-Gateway (Simulator) lauscht auf Port ${PORT} — NICHT fiskalisch gültig`)
})
