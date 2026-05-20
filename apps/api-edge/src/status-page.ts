import os from 'os'

/**
 * Get the local (non-internal) IPv4 address.
 */
export function getLocalIpAddress(): string {
  const interfaces = os.networkInterfaces()
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address
      }
    }
  }
  return '127.0.0.1'
}

/**
 * Format seconds into a human-readable string like "2d 5h 12m 3s".
 */
function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)

  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  if (m > 0) parts.push(`${m}m`)
  parts.push(`${s}s`)
  return parts.join(' ')
}

/**
 * Render the API status page HTML with live server metadata.
 * Design matches the Setup Client (black background, gray-900 cards, green-500 accents, Switzer font).
 */
export function renderStatusPage(options: { host: string; port: number }): string {
  const uptime = process.uptime()
  const memUsage = process.memoryUsage()
  const localIp = getLocalIpAddress()

  return /* html */ `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Panary Core API — Status</title>
  <!-- Panary-Favicon (adaptives SVG, light/dark) — inline als Data-URI, da die
       Status-Seite ein Backend-HTML-String ohne Static-Asset-Serving ist.
       Quelle: apps/admin-client/public/favicon.svg (1:1 übernommen). -->
  <link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cstyle%3E.bg%7Bfill:%230f172a%7D.icon%7Bfill:%23ffffff%7D@media(prefers-color-scheme:dark)%7B.bg%7Bfill:%23f1f5f9%7D.icon%7Bfill:%230f172a%7D%7D%3C/style%3E%3Crect class='bg' x='0' y='0' width='64' height='64' rx='13'/%3E%3Crect class='icon' x='16' y='14' width='13' height='35' rx='2'/%3E%3Crect class='icon' x='32' y='14' width='16' height='19' rx='2'/%3E%3C/svg%3E">
  <link rel="preconnect" href="https://api.fontshare.com">
  <link href="https://api.fontshare.com/v2/css?f[]=switzer@100,200,300,400,500,600,700,800,900&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

    html, body {
      height: 100%;
      background-color: #000;
      color: #fff;
      font-family: 'Switzer', -apple-system, BlinkMacSystemFont, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    body {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      padding: 2rem;
    }

    /* ---- Icon circle ---- */
    .icon-circle {
      width: 6rem;
      height: 6rem;
      border-radius: 50%;
      background-color: transparent;
      border: 2px solid #fff;
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 2rem;
      animation: pulse 2s ease-in-out infinite;
    }
    .icon-circle svg { width: 3rem; height: 3rem; color: #fff; }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    /* ---- Header ---- */
    .header { text-align: center; margin-bottom: 2rem; }
    .header h1 { font-size: 1.875rem; font-weight: 700; }
    .header p  { color: #9ca3af; margin-top: 0.5rem; font-size: 0.95rem; }

    /* ---- Card ---- */
    .card {
      background-color: rgba(17, 24, 39, 0.5); /* gray-900/50 */
      border: 1px solid #1f2937; /* gray-800 */
      border-radius: 0.75rem;
      padding: 1.5rem;
      width: 100%;
      max-width: 28rem;
      margin-bottom: 1rem;
    }

    /* ---- Row ---- */
    .row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      padding-bottom: 0.625rem;
      margin-bottom: 0.625rem;
      border-bottom: 1px solid #1f2937; /* gray-800 */
    }
    .row:last-child { border-bottom: none; padding-bottom: 0; margin-bottom: 0; }

    .row .label { color: #6b7280; font-size: 0.9rem; } /* gray-500 */
    .row .value {
      font-size: 0.9rem;
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      font-family: 'JetBrains Mono', 'Courier New', monospace;
    }
    .row .value.green { color: #22c55e; font-weight: 700; font-family: 'Switzer', sans-serif; }

    /* ---- Links ---- */
    .links {
      display: flex;
      gap: 0.75rem;
      width: 100%;
      max-width: 28rem;
      margin-top: 0.5rem;
    }
    .links a {
      flex: 1;
      text-align: center;
      padding: 1rem 1.5rem;
      border-radius: 0.75rem;
      font-size: 1rem;
      font-weight: 700;
      text-decoration: none;
      transition: background-color 0.15s;
    }
    .links .primary   { background: #fff; color: #000; }
    .links .primary:hover { background: #e5e7eb; }
    .links .secondary { background: #1f2937; color: #fff; border: 1px solid #374151; }
    .links .secondary:hover { background: #374151; }
  </style>
</head>
<body>

  <div class="icon-circle">
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
      <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </svg>
  </div>

  <div class="header">
    <h1>Panary Core API</h1>
    <p>Edge Server · Running</p>
  </div>

  <div class="card">
    <div class="row">
      <span class="label">Status</span>
      <span class="value green">Active</span>
    </div>
    <div class="row">
      <span class="label">Uptime</span>
      <span class="value">${formatUptime(uptime)}</span>
    </div>
    <div class="row">
      <span class="label">Version</span>
      <span class="value">${process.env['npm_package_version'] || '1.0.0'}</span>
    </div>
    <div class="row">
      <span class="label">IP</span>
      <span class="value">${localIp}:${options.port}</span>
    </div>
  </div>

  <div class="card">
    <div class="row">
      <span class="label">Node.js</span>
      <span class="value">${process.version}</span>
    </div>
    <div class="row">
      <span class="label">Platform</span>
      <span class="value">${os.platform()} ${os.arch()}</span>
    </div>
    <div class="row">
      <span class="label">Memory (RSS)</span>
      <span class="value">${(memUsage.rss / 1024 / 1024).toFixed(1)} MB</span>
    </div>
    <div class="row">
      <span class="label">Heap Used</span>
      <span class="value">${(memUsage.heapUsed / 1024 / 1024).toFixed(1)} / ${(memUsage.heapTotal / 1024 / 1024).toFixed(1)} MB</span>
    </div>
  </div>

  <div class="links">
    <a class="primary" href="/admin">Admin Panel</a>
    <a class="secondary" href="/docs">API-Dokumentation</a>
  </div>

</body>
</html>`
}
