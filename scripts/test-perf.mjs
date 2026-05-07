import { spawnSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

// Intencion: convertir BR-1 en una compuerta local reproducible para rendimiento movil.
// Flujo: prueba de ruta grande -> build de produccion -> lectura de assets de entrada -> comparacion
// contra un presupuesto versionado que evita crecer el costo inicial del frontend sin decision explicita.
// Riesgo: el presupuesto esta calibrado sobre el baseline actual; si se rompe, la salida correcta no es
// subir el limite por inercia sino justificar el cambio o reducir el bundle antes de avanzar.
const PERFORMANCE_BUDGET = {
  entryAssets: {
    maxCssGzipBytes: 6_500,
    maxCssRawBytes: 30_000,
    maxJavascriptGzipBytes: 125_000,
    maxJavascriptRawBytes: 390_000,
    maxTotalGzipBytes: 130_000,
    maxTotalRawBytes: 420_000,
  },
  routeBoardPerf: {
    file: 'src/lib/collector/collector-route-board.test.ts',
    testNamePattern: 'builds a simulated large route board without degrading the operational sort',
  },
}

main()

function main() {
  runCommand('route board runtime budget', [
    'run',
    'test',
    '--',
    PERFORMANCE_BUDGET.routeBoardPerf.file,
    '-t',
    PERFORMANCE_BUDGET.routeBoardPerf.testNamePattern,
  ])

  runCommand('production build for entry asset budget', ['run', 'build'])

  const summary = analyzeEntryAssets()
  const failures = collectBudgetFailures(summary)

  console.log('\n[perf] Entry asset summary')
  console.log(JSON.stringify(summary, null, 2))

  if (failures.length > 0) {
    console.error('\n[perf] Budget failures detected:')

    for (const failure of failures) {
      console.error(`- ${failure}`)
    }

    process.exitCode = 1
    return
  }

  console.log('\n[perf] All runtime and bundle budgets passed.')
}

function runCommand(label, args) {
  console.log(`\n[perf] Running ${label}...`)
  const result = spawnSync(npmCommand, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

function analyzeEntryAssets() {
  const distDir = join(repoRoot, 'dist')
  const indexHtmlPath = join(distDir, 'index.html')
  const indexHtml = readFileSync(indexHtmlPath, 'utf8')
  const entryAssetRefs = [...new Set([...indexHtml.matchAll(/(?:\.\/)?assets\/[^"' )>]+/g)].map((match) => match[0]))]

  if (entryAssetRefs.length === 0) {
    throw new Error('entry_assets_not_found_in_dist_index')
  }

  const entryAssets = entryAssetRefs.map((assetRef) => summarizeAsset(join(distDir, assetRef.replace(/^\.\//, ''))))
  const javascriptAssets = entryAssets.filter((asset) => asset.kind === 'javascript')
  const cssAssets = entryAssets.filter((asset) => asset.kind === 'css')

  return {
    budgets: PERFORMANCE_BUDGET.entryAssets,
    css: summarizeGroup(cssAssets),
    entryAssets,
    javascript: summarizeGroup(javascriptAssets),
    totals: summarizeGroup(entryAssets),
  }
}

function summarizeAsset(assetPath) {
  const assetBuffer = readFileSync(assetPath)
  const rawBytes = statSync(assetPath).size
  const gzipBytes = gzipSync(assetBuffer).length
  const assetName = assetPath.split('/').pop() ?? assetPath
  const kind = assetName.endsWith('.css')
    ? 'css'
    : assetName.endsWith('.js')
      ? 'javascript'
      : 'other'

  return {
    gzipBytes,
    kind,
    name: assetName,
    rawBytes,
  }
}

function summarizeGroup(assets) {
  const totalRawBytes = assets.reduce((accumulator, asset) => accumulator + asset.rawBytes, 0)
  const totalGzipBytes = assets.reduce((accumulator, asset) => accumulator + asset.gzipBytes, 0)
  const largestRawBytes = assets.reduce((largest, asset) => Math.max(largest, asset.rawBytes), 0)
  const largestGzipBytes = assets.reduce((largest, asset) => Math.max(largest, asset.gzipBytes), 0)

  return {
    assetCount: assets.length,
    largestGzipBytes,
    largestRawBytes,
    totalGzipBytes,
    totalRawBytes,
  }
}

function collectBudgetFailures(summary) {
  const failures = []
  const { entryAssets: budget } = PERFORMANCE_BUDGET

  if (summary.totals.totalRawBytes > budget.maxTotalRawBytes) {
    failures.push(`entry assets raw bytes ${summary.totals.totalRawBytes} exceed ${budget.maxTotalRawBytes}`)
  }

  if (summary.totals.totalGzipBytes > budget.maxTotalGzipBytes) {
    failures.push(`entry assets gzip bytes ${summary.totals.totalGzipBytes} exceed ${budget.maxTotalGzipBytes}`)
  }

  if (summary.javascript.largestRawBytes > budget.maxJavascriptRawBytes) {
    failures.push(
      `largest javascript asset raw bytes ${summary.javascript.largestRawBytes} exceed ${budget.maxJavascriptRawBytes}`,
    )
  }

  if (summary.javascript.largestGzipBytes > budget.maxJavascriptGzipBytes) {
    failures.push(
      `largest javascript asset gzip bytes ${summary.javascript.largestGzipBytes} exceed ${budget.maxJavascriptGzipBytes}`,
    )
  }

  if (summary.css.largestRawBytes > budget.maxCssRawBytes) {
    failures.push(`largest css asset raw bytes ${summary.css.largestRawBytes} exceed ${budget.maxCssRawBytes}`)
  }

  if (summary.css.largestGzipBytes > budget.maxCssGzipBytes) {
    failures.push(`largest css asset gzip bytes ${summary.css.largestGzipBytes} exceed ${budget.maxCssGzipBytes}`)
  }

  return failures
}
