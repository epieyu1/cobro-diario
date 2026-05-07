import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_APP_HOST = '127.0.0.1'
const DEFAULT_APP_PORT = Number(process.env.PHASE4_SMOKE_PORT ?? '4174')
const DEFAULT_APP_URL = process.env.PHASE4_SMOKE_URL ?? `http://${DEFAULT_APP_HOST}:${DEFAULT_APP_PORT}/`
const DEFAULT_CHROME_PATH =
  process.env.PHASE4_SMOKE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const DEFAULT_DEBUG_PORT = Number(process.env.PHASE4_SMOKE_DEBUG_PORT ?? '9333')
const DEFAULT_DEBUG_HOST = process.env.PHASE4_SMOKE_DEBUG_HOST ?? 'localhost'
const DEFAULT_WIDTH = 390
const DEFAULT_HEIGHT = 844
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/136.0.0.0 Mobile/15E148 Safari/604.1'

const usage = `Usage:
  node scripts/phase4-mobile-smoke.mjs <email> <password>

Environment overrides:
  PHASE4_SMOKE_URL=http://127.0.0.1:4174/
  PHASE4_SMOKE_PORT=4174
  PHASE4_SMOKE_CHROME=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome
  PHASE4_SMOKE_DEBUG_PORT=9333
`

let devServerProcess = null
let chromeProcess = null
let chromeUserDataDir = null
let cleanupStarted = false

const devServerOutput = []
const chromeOutput = []

main().catch(async (error) => {
  await cleanup()
  console.error(
    JSON.stringify(
      {
        chromeOutput: chromeOutput.slice(-20),
        devServerOutput: devServerOutput.slice(-20),
        message: error instanceof Error ? error.message : String(error),
      },
      null,
      2,
    ),
  )
  process.exitCode = 1
})

async function main() {
  const email = process.argv[2]
  const password = process.argv[3]

  if (!email || !password) {
    throw new Error(usage)
  }

  if (!existsSync(DEFAULT_CHROME_PATH)) {
    throw new Error(`chrome_binary_not_found:${DEFAULT_CHROME_PATH}`)
  }

  installProcessGuards()
  await startDevServer()
  await waitForHttp(DEFAULT_APP_URL, 30_000)
  await startHeadlessChrome(DEFAULT_APP_URL)

  const pageTarget = await waitForPageTarget(DEFAULT_DEBUG_HOST, DEFAULT_DEBUG_PORT, DEFAULT_APP_URL, 15_000)
  const client = await createCdpClient(pageTarget.webSocketDebuggerUrl)

  try {
    await client.send('Page.enable')
    await client.send('Runtime.enable')
    await client.send('Log.enable')
    await client.send('Network.enable')
    await client.send('Emulation.setDeviceMetricsOverride', {
      deviceScaleFactor: 3,
      height: DEFAULT_HEIGHT,
      mobile: true,
      screenHeight: DEFAULT_HEIGHT,
      screenWidth: DEFAULT_WIDTH,
      width: DEFAULT_WIDTH,
    })
    await client.send('Emulation.setUserAgentOverride', {
      platform: 'iOS',
      userAgent: DEFAULT_USER_AGENT,
    })
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      // Esta instrumentacion deja visible si el flujo autentico de Fase 4 produce
      // errores de runtime o promesas rechazadas durante login, offline y re-sync.
      source: `
        window.__phase4SmokeErrors = [];
        window.addEventListener('error', (event) => {
          window.__phase4SmokeErrors.push({
            message: event.message,
            source: event.filename || null,
          });
        });
        window.addEventListener('unhandledrejection', (event) => {
          const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
          window.__phase4SmokeErrors.push({
            message: reason,
            source: 'unhandledrejection',
          });
        });
      `,
    })
    await client.send('Page.navigate', { url: DEFAULT_APP_URL })
    await client.waitForEvent('Page.loadEventFired', 20_000)

    await waitForCondition(
      client,
      'collector login panel visible',
      `Boolean(document.querySelector('#collector-login-panel'))`,
      30_000,
    )

    await fillInput(client, '#collector-login-panel input[type="email"]', email)
    await fillInput(client, '#collector-login-panel input[type="password"]', password)
    await clickBySelector(client, '#collector-login-panel button[type="submit"]')

    await waitForCondition(
      client,
      'authenticated workspace visible',
      `Boolean(document.querySelector('.loan-row')) && document.body.textContent.includes('Panel de Control')`,
      30_000,
    )

    const portfolioCount = await evaluateValue(
      client,
      `document.querySelectorAll('.loan-row').length`,
    )

    await clickBySelector(client, 'button[aria-label="Abrir menú"]')
    await waitForCondition(
      client,
      'mobile navigation drawer open',
      `Boolean(document.querySelector('#mobile-navigation-drawer.open'))`,
      10_000,
    )

    await waitForCondition(
      client,
      'authenticated drawer options visible',
      `['Cartera', 'Detalle', 'Operacion'].every((label) =>
        Array.from(document.querySelectorAll('#mobile-navigation-drawer button')).some((button) =>
          button.textContent.replace(/\\s+/g, ' ').includes(label)
        )
      )`,
      10_000,
    )

    await clickButtonByText(client, '#mobile-navigation-drawer button', 'Detalle')
    await waitForCondition(
      client,
      'detail pane active',
      `Boolean(document.querySelector('.loan-detail-panel.is-active h2'))`,
      10_000,
    )

    const selectedCustomer = await evaluateValue(
      client,
      `document.querySelector('.loan-detail-panel.is-active h2')?.textContent?.trim() ?? null`,
    )

    await clickBySelector(client, 'button[aria-label="Abrir menú"]')
    await waitForCondition(
      client,
      'mobile navigation drawer reopened',
      `Boolean(document.querySelector('#mobile-navigation-drawer.open'))`,
      10_000,
    )
    await clickButtonByText(client, '#mobile-navigation-drawer button', 'Operacion')

    await waitForCondition(
      client,
      'operations sheet open',
      `Boolean(document.querySelector('.operations-sheet.open'))`,
      10_000,
    )

    // El smoke offline/online usa los mismos eventos del navegador que escucha App.tsx.
    // No falseamos el RPC ni la cola: forzamos el estado offline local, encolamos el pago
    // y luego devolvemos online para que el runtime real haga el flush hacia LANDING.
    await dispatchWindowEvent(client, 'offline')
    await waitForCondition(
      client,
      'offline runtime indicator visible',
      `Array.from(document.querySelectorAll('.status-card')).some((card) =>
        card.textContent?.includes('Red') && card.textContent?.includes('Offline')
      )`,
      10_000,
    )

    await clickButtonByText(client, '.operations-content button', 'Cuota actual')
    await waitForCondition(
      client,
      'payment amount copied from current installment',
      `Boolean(document.querySelector('.operations-content input[inputmode="decimal"]')?.value)`,
      10_000,
    )
    await clickButtonByText(client, '.operations-content button', 'Confirmar Cobro')

    await waitForCondition(
      client,
      'offline payment queued notice',
      `document.body.textContent.includes('Cobro registrado en la cola local')`,
      15_000,
    )
    await waitForCondition(
      client,
      'pending receipt visible',
      `document.querySelector('.receipt-card')?.textContent?.includes('Pendiente') ?? false`,
      15_000,
    )

    const queuedSnapshot = await evaluateValue(
      client,
      `Array.from(document.querySelectorAll('.status-card'))
        .find((card) => card.textContent?.includes('Cola'))
        ?.textContent?.replace(/\\s+/g, ' ')
        ?.trim() ?? null`,
    )

    await dispatchWindowEvent(client, 'online')
    await waitForCondition(
      client,
      'queue drained after online sync',
      `Array.from(document.querySelectorAll('.status-card')).some((card) =>
        card.textContent?.includes('Cola') && card.textContent?.includes('0 pendientes / 0 fallidos')
      )`,
      30_000,
    )
    await waitForCondition(
      client,
      'receipt marked as synced',
      `document.querySelector('.receipt-card')?.textContent?.includes('Sincronizado') ?? false`,
      30_000,
    )

    const pageErrors = await evaluateValue(client, 'window.__phase4SmokeErrors ?? []')

    if (client.consoleErrors.length > 0 || client.runtimeExceptions.length > 0 || pageErrors.length > 0) {
      throw new Error(
        JSON.stringify(
          {
            consoleErrors: client.consoleErrors,
            pageErrors,
            runtimeExceptions: client.runtimeExceptions,
          },
          null,
          2,
        ),
      )
    }

    console.log(
      JSON.stringify(
        {
          appUrl: DEFAULT_APP_URL,
          customer: selectedCustomer,
          offlineQueueSnapshot: queuedSnapshot,
          portfolioCount,
          result: 'ok',
        },
        null,
        2,
      ),
    )
  } finally {
    await client.close()
    await cleanup()
  }
}

function installProcessGuards() {
  const handleSignal = async () => {
    await cleanup()
    process.exit(1)
  }

  process.on('SIGINT', handleSignal)
  process.on('SIGTERM', handleSignal)
}

async function startDevServer() {
  devServerProcess = spawn(
    'npm',
    ['run', 'dev', '--', '--host', DEFAULT_APP_HOST, '--port', String(DEFAULT_APP_PORT)],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  devServerProcess.stdout.on('data', (chunk) => {
    devServerOutput.push(chunk.toString())
  })
  devServerProcess.stderr.on('data', (chunk) => {
    devServerOutput.push(chunk.toString())
  })
}

async function startHeadlessChrome(url) {
  chromeUserDataDir = mkdtempSync(join(tmpdir(), 'codex-phase4-mobile-'))
  chromeProcess = spawn(
    DEFAULT_CHROME_PATH,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      `--remote-debugging-port=${DEFAULT_DEBUG_PORT}`,
      `--user-data-dir=${chromeUserDataDir}`,
      `--window-size=${DEFAULT_WIDTH},${DEFAULT_HEIGHT}`,
      url,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )

  chromeProcess.stdout.on('data', (chunk) => {
    chromeOutput.push(chunk.toString())
  })
  chromeProcess.stderr.on('data', (chunk) => {
    chromeOutput.push(chunk.toString())
  })
}

async function cleanup() {
  if (cleanupStarted) {
    return
  }

  cleanupStarted = true

  if (chromeProcess) {
    await stopChildProcess(chromeProcess)
    chromeProcess = null
  }

  if (devServerProcess) {
    await stopChildProcess(devServerProcess)
    devServerProcess = null
  }

  if (chromeUserDataDir) {
    await removeDirectorySafely(chromeUserDataDir)
    chromeUserDataDir = null
  }
}

async function waitForHttp(url, timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url)

      if (response.ok) {
        return
      }
    } catch {
      // Esperamos el próximo intento mientras Vite termina de abrir.
    }

    await sleep(500)
  }

  throw new Error(`http_wait_timeout:${url}`)
}

async function waitForPageTarget(debugHost, debugPort, appUrl, timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`http://${debugHost}:${debugPort}/json/list`)
      const targets = await response.json()
      const pageTarget = targets.find((target) => target.type === 'page' && target.url.startsWith(appUrl))

      if (pageTarget?.webSocketDebuggerUrl) {
        return pageTarget
      }
    } catch {
      // Chrome puede tardar en exponer el target remoto; seguimos reintentando.
    }

    await sleep(500)
  }

  throw new Error(`chrome_target_timeout:${appUrl}`)
}

async function createCdpClient(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl)
  const pendingRequests = new Map()
  const eventWaiters = new Map()
  const consoleErrors = []
  const runtimeExceptions = []
  let nextId = 1

  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener(
      'error',
      () => reject(new Error('cdp_socket_open_failed')),
      { once: true },
    )
  })

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)

    if (message.id) {
      const pendingRequest = pendingRequests.get(message.id)

      if (!pendingRequest) {
        return
      }

      pendingRequests.delete(message.id)

      if (message.error) {
        pendingRequest.reject(new Error(`cdp_error:${message.error.message}`))
        return
      }

      pendingRequest.resolve(message.result ?? {})
      return
    }

    if (message.method === 'Runtime.consoleAPICalled' && message.params?.type === 'error') {
      consoleErrors.push(
        message.params.args?.map((argument) => argument.value ?? argument.description ?? null).filter(Boolean),
      )
    }

    if (message.method === 'Runtime.exceptionThrown') {
      runtimeExceptions.push(message.params.exceptionDetails?.text ?? 'runtime_exception')
    }

    const waiters = eventWaiters.get(message.method)

    if (!waiters?.length) {
      return
    }

    for (const waiter of waiters.splice(0)) {
      waiter.resolve(message.params ?? {})
    }
  })

  return {
    consoleErrors,
    runtimeExceptions,
    async close() {
      socket.close()
    },
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = nextId++
        pendingRequests.set(id, { reject, resolve })
        socket.send(JSON.stringify({ id, method, params }))
      })
    },
    waitForEvent(method, timeoutMs) {
      return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          const waiters = eventWaiters.get(method) ?? []
          eventWaiters.set(
            method,
            waiters.filter((waiter) => waiter.resolve !== resolve),
          )
          reject(new Error(`event_timeout:${method}`))
        }, timeoutMs)

        const waiters = eventWaiters.get(method) ?? []
        waiters.push({
          resolve: (params) => {
            clearTimeout(timeoutId)
            resolve(params)
          },
        })
        eventWaiters.set(method, waiters)
      })
    },
  }
}

async function waitForCondition(client, label, expression, timeoutMs) {
  const startedAt = Date.now()

  while (Date.now() - startedAt < timeoutMs) {
    const result = await evaluateValue(client, expression)

    if (result) {
      return result
    }

    await sleep(250)
  }

  const debugSnapshot = await captureDebugSnapshot(client)
  throw new Error(`condition_timeout:${label}:${JSON.stringify(debugSnapshot)}`)
}

async function evaluateValue(client, expression) {
  const result = await client.send('Runtime.evaluate', {
    awaitPromise: true,
    expression,
    returnByValue: true,
  })

  return result.result?.value
}

async function fillInput(client, selector, value) {
  const result = await evaluateValue(
    client,
    `(() => {
      const input = document.querySelector(${JSON.stringify(selector)});
      if (!input) return false;
      const prototype =
        input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const valueDescriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      if (!valueDescriptor?.set) return false;
      input.focus();
      valueDescriptor.set.call(input, ${JSON.stringify(value)});
      input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(value)}, inputType: 'insertText' }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    })()`,
  )

  if (!result) {
    throw new Error(`fill_input_failed:${selector}`)
  }
}

async function clickBySelector(client, selector) {
  const result = await evaluateValue(
    client,
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (!element) return false;
      element.click();
      return true;
    })()`,
  )

  if (!result) {
    throw new Error(`click_failed:${selector}`)
  }
}

async function clickButtonByText(client, selector, text) {
  const result = await evaluateValue(
    client,
    `(() => {
      const normalizedTarget = ${JSON.stringify(text)};
      const candidate = Array.from(document.querySelectorAll(${JSON.stringify(selector)})).find((element) =>
        element.textContent?.replace(/\\s+/g, ' ').trim().includes(normalizedTarget)
      );
      if (!candidate) return false;
      candidate.click();
      return true;
    })()`,
  )

  if (!result) {
    throw new Error(`click_text_failed:${selector}:${text}`)
  }
}

async function dispatchWindowEvent(client, eventName) {
  const result = await evaluateValue(
    client,
    `(() => {
      window.dispatchEvent(new Event(${JSON.stringify(eventName)}));
      return true;
    })()`,
  )

  if (!result) {
    throw new Error(`dispatch_event_failed:${eventName}`)
  }
}

async function captureDebugSnapshot(client) {
  try {
    return await evaluateValue(
      client,
      `(() => ({
        activeTitle: document.querySelector('.mobile-shell-title')?.textContent?.trim() ?? null,
        activeView: document.querySelector('.workspace-pane.is-active h2')?.textContent?.trim() ?? null,
        bodyText: document.body.textContent.replace(/\\s+/g, ' ').trim().slice(0, 1200),
        notice: document.querySelector('.banner.success')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
        runtimeError: document.querySelector('.banner.danger')?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
      }))()`,
    )
  } catch {
    return {
      bodyText: 'debug_snapshot_unavailable',
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
}

async function stopChildProcess(childProcess) {
  if (childProcess.exitCode !== null || childProcess.killed) {
    return
  }

  childProcess.kill('SIGTERM')

  await Promise.race([
    new Promise((resolve) => {
      childProcess.once('exit', resolve)
    }),
    sleep(5_000),
  ])
}

async function removeDirectorySafely(directoryPath) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    try {
      rmSync(directoryPath, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 100,
      })
      return
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOTEMPTY') {
        return
      }

      await sleep(250)
    }
  }
}
