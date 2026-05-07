import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useState,
} from 'react'
import { canAccessOperationalReports } from '@/lib/auth/role-guards.ts'
import type { SessionProfile } from '@/lib/db/local-db.ts'
import { FINANCIAL_BASELINE } from '@/lib/finance/financial-config.ts'
import { formatCurrency } from '@/lib/finance/money.ts'
import type { OperationalReportTransport } from '@/lib/reports/report-queries.ts'
import {
  REPORTABLE_LOAN_STATUSES,
  type OperationalReportSnapshot,
} from '@/lib/reports/report-types.ts'
import type { SyncQueueSnapshot } from '@/lib/sync/payment-sync.ts'
import { env } from '@/lib/env.ts'
import type { LoanStatus } from '@/types/domain.ts'

type ReportPanelProps = {
  isOnline: boolean
  profile?: SessionProfile
  queueSnapshot: Pick<SyncQueueSnapshot, 'failed' | 'pending' | 'processing'>
  transport: OperationalReportTransport | null
}

type ReportFilterValue = {
  collectorId: string
  loanStatus: LoanStatus | 'all'
  routeLabel: string
}

const initialFilters: ReportFilterValue = {
  collectorId: 'all',
  loanStatus: 'all',
  routeLabel: 'all',
}

export function ReportPanel({
  isOnline,
  profile,
  queueSnapshot,
  transport,
}: ReportPanelProps) {
  const [filters, setFilters] = useState<ReportFilterValue>(initialFilters)
  const [report, setReport] = useState<OperationalReportSnapshot | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [isLoadingReport, setIsLoadingReport] = useState(false)
  const [reloadToken, setReloadToken] = useState(0)
  const canAccessReports = canAccessOperationalReports(profile)
  const normalizedFilters = useMemo(
    () => ({
      collectorId: filters.collectorId === 'all' ? undefined : filters.collectorId,
      loanStatus: filters.loanStatus === 'all' ? undefined : filters.loanStatus,
      routeLabel: filters.routeLabel === 'all' ? undefined : filters.routeLabel,
    }),
    [filters],
  )
  const localSyncSummary = useMemo(
    () => describeLocalSyncHealth(queueSnapshot),
    [queueSnapshot],
  )

  const loadReport = useEffectEvent(async (isActive: () => boolean) => {
    if (!transport) {
      return
    }

    setIsLoadingReport(true)
    setReportError(null)

    try {
      const nextReport = await transport.getOperationalReport(normalizedFilters)

      if (!isActive()) {
        return
      }

      startTransition(() => {
        setReport(nextReport)
      })
    } catch (error) {
      if (!isActive()) {
        return
      }

      startTransition(() => {
        setReportError(describeOperationalReportError(error))
      })
    } finally {
      if (isActive()) {
        setIsLoadingReport(false)
      }
    }
  })

  useEffect(() => {
    if (!canAccessReports || !transport || !isOnline) {
      return
    }

    let active = true

    void loadReport(() => active)

    return () => {
      active = false
    }
  }, [canAccessReports, isOnline, reloadToken, transport, normalizedFilters])

  function updateFilter(field: keyof ReportFilterValue, value: string) {
    setReportError(null)
    startTransition(() => {
      setFilters((currentFilters) => ({
        ...currentFilters,
        [field]: value,
      }))
    })
  }

  if (!profile) {
    return (
      <div className="warn-box inline" role="alert">
        <strong>Reportes bloqueados</strong>
        <p>La sesión necesita un perfil remoto válido antes de abrir indicadores operativos.</p>
      </div>
    )
  }

  if (!canAccessReports) {
    return (
      <div className="warn-box inline" role="alert">
        <strong>Solo administrador</strong>
        <p>Los reportes operativos globales no están disponibles para el rol actual.</p>
      </div>
    )
  }

  return (
    <section className="reports-panel" aria-label="Reportes operativos">
      <div className="reports-toolbar">
        <p className="muted-copy">
          La cartera, el cobro del día y la mora salen de PostgreSQL por RPC bajo RLS. La salud de
          sincronización mostrada aquí sigue siendo local a este dispositivo porque la cola oficial
          vive en IndexedDB.
        </p>

        <div className="reports-filter-grid">
          <label className="field">
            <span>Cobrador</span>
            <select
              className="input"
              value={filters.collectorId}
              onChange={(event) => updateFilter('collectorId', event.target.value)}
            >
              <option value="all">Todos los cobradores</option>
              {(report?.collectors ?? []).map((collector) => (
                <option key={collector.collectorId} value={collector.collectorId}>
                  {collector.collectorName}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Ruta</span>
            <select
              className="input"
              value={filters.routeLabel}
              onChange={(event) => updateFilter('routeLabel', event.target.value)}
            >
              <option value="all">Todas las rutas</option>
              {(report?.routes ?? []).map((route) => (
                <option key={route.routeLabel} value={route.routeLabel}>
                  {route.routeLabel}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Estado</span>
            <select
              className="input"
              value={filters.loanStatus}
              onChange={(event) => updateFilter('loanStatus', event.target.value)}
            >
              <option value="all">Todos los estados</option>
              {REPORTABLE_LOAN_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {describeLoanStatus(status)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="report-inline-actions">
          <button
            className="button secondary"
            disabled={!isOnline || !transport || isLoadingReport}
            onClick={() => setReloadToken((currentToken) => currentToken + 1)}
            type="button"
          >
            {isLoadingReport ? 'Actualizando...' : 'Actualizar reportes'}
          </button>
          <button
            className="button ghost"
            onClick={() => {
              setReportError(null)
              setFilters(initialFilters)
            }}
            type="button"
          >
            Limpiar filtros
          </button>
        </div>
      </div>

      {!isOnline || !transport ? (
        <div className="warn-box inline" role="alert">
          <strong>Requiere conexión</strong>
          <p>Este panel consume un RPC de solo lectura sobre `LANDING` y no se genera offline.</p>
        </div>
      ) : null}

      {reportError ? (
        <div className="warn-box inline" role="alert">
          <strong>No se pudieron cargar los reportes</strong>
          <p>{reportError}</p>
        </div>
      ) : null}

      {report ? (
        <>
          <div className="reports-metrics-grid" role="region" aria-label="Métricas de reportes">
            <article className="metric-card accent">
              <span>Saldo en Cartera</span>
              <strong>
                {formatCurrency(
                  report.metrics.outstandingAmount,
                  FINANCIAL_BASELINE.currencyCode,
                  env.defaultLocale,
                )}
              </strong>
            </article>
            <article className="metric-card">
              <span>Clientes</span>
              <strong>{report.metrics.customerCount}</strong>
            </article>
            <article className="metric-card warning">
              <span>Vencidos</span>
              <strong>{report.metrics.overdueLoanCount}</strong>
            </article>
            <article className="metric-card">
              <span>Vencimiento Hoy</span>
              <strong>{report.metrics.dueTodayLoanCount}</strong>
            </article>
            <article className="metric-card success">
              <span>Recaudo del Día</span>
              <strong>
                {formatCurrency(
                  report.metrics.collectedTodayAmount,
                  FINANCIAL_BASELINE.currencyCode,
                  env.defaultLocale,
                )}
              </strong>
            </article>
            <article className={`metric-card ${localSyncSummary.tone}`}>
              <span>Sincronización del Dispositivo</span>
              <strong>{localSyncSummary.label}</strong>
            </article>
          </div>

          <div className="preview-box muted-box">
            <strong>Cierre Operativo</strong>
            <p>
              Fecha de negocio {formatReportDate(report.businessDate)} · generado{' '}
              {formatReportTimestamp(report.generatedAt)} · {report.metrics.collectedTodayCount} cobro(s) aplicado(s) hoy.
            </p>
            <small className="origination-helper">
              Integridad de Datos Local: {localSyncSummary.summary}
            </small>
          </div>

          <div className="reports-section">
            <div className="management-heading">
              <strong>Por cobrador</strong>
              <span>Separación visible entre supervisión administrativa y trabajo de calle.</span>
            </div>

            <div className="reports-breakdown">
              {report.collectors.length ? (
                report.collectors.map((collector) => (
                  <article key={collector.collectorId} className="report-row">
                    <div className="report-row-copy">
                      <strong>{collector.collectorName}</strong>
                      <span>
                        {collector.customerCount} cliente(s) · {collector.openLoanCount} préstamo(s) abierto(s)
                      </span>
                    </div>
                    <div className="report-row-metrics">
                      <span className="chip warning">{collector.overdueLoanCount} en mora</span>
                      <span className="chip pending">{collector.dueTodayLoanCount} para hoy</span>
                      <strong>
                        {formatCurrency(
                          collector.collectedTodayAmount,
                          FINANCIAL_BASELINE.currencyCode,
                          env.defaultLocale,
                        )}
                      </strong>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <strong>Sin cartera visible</strong>
                  <p>Los filtros actuales no dejan cobradores dentro del alcance del reporte.</p>
                </div>
              )}
            </div>
          </div>

          <div className="reports-section">
            <div className="management-heading">
              <strong>Por ruta</strong>
              <span>La ruta sigue usando `route_label` como fuente remota vigente del agrupador.</span>
            </div>

            <div className="reports-breakdown">
              {report.routes.length ? (
                report.routes.map((route) => (
                  <article key={route.routeLabel} className="report-row">
                    <div className="report-row-copy">
                      <strong>{route.routeLabel}</strong>
                      <span>
                        {route.customerCount} cliente(s) · {route.openLoanCount} préstamo(s) abierto(s)
                      </span>
                    </div>
                    <div className="report-row-metrics">
                      <span className="chip warning">{route.overdueLoanCount} en mora</span>
                      <span className="chip route">{route.dueTodayLoanCount} para hoy</span>
                      <strong>
                        {formatCurrency(
                          route.outstandingAmount,
                          FINANCIAL_BASELINE.currencyCode,
                          env.defaultLocale,
                        )}
                      </strong>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <strong>Sin rutas visibles</strong>
                  <p>Los filtros actuales no dejan rutas dentro del alcance del reporte.</p>
                </div>
              )}
            </div>
          </div>

          <div className="reports-section">
            <div className="management-heading">
              <strong>Por estado</strong>
              <span>Resumen rápido para revisar distribución de cartera antes de abrir reversos o V2.</span>
            </div>

            <div className="reports-breakdown">
              {report.statuses.length ? (
                report.statuses.map((statusSummary) => (
                  <article key={statusSummary.status} className="report-row">
                    <div className="report-row-copy">
                      <strong>{describeLoanStatus(statusSummary.status)}</strong>
                      <span>{statusSummary.loanCount} préstamo(s)</span>
                    </div>
                    <div className="report-row-metrics">
                      <strong>
                        {formatCurrency(
                          statusSummary.outstandingAmount,
                          FINANCIAL_BASELINE.currencyCode,
                          env.defaultLocale,
                        )}
                      </strong>
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <strong>Sin estados visibles</strong>
                  <p>Los filtros actuales dejaron la vista sin préstamos para resumir.</p>
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <div className="empty-state" role="status">
          <strong>{isLoadingReport ? 'Cargando reportes...' : 'Sin reporte cargado'}</strong>
          <p>
            {isLoadingReport
              ? 'La vista administrativa está consultando PostgreSQL bajo RLS.'
              : 'Abre la conexión y actualiza para cargar el primer corte operativo.'}
          </p>
        </div>
      )}
    </section>
  )
}

function describeOperationalReportError(error: unknown) {
  if (!(error instanceof Error)) {
    return 'Error de sistema no identificado.'
  }

  const knownMessages: Record<string, string> = {
    authentication_required: 'La sesión ya no está autenticada para consultar reportes.',
    invalid_operational_report: 'El servidor devolvió un reporte con formato inválido.',
    loan_status_invalid: 'El filtro de estado no pertenece al contrato operativo.',
    operator_inactive: 'Tu perfil está inactivo y no puede abrir reportes administrativos.',
    report_role_not_allowed: 'Solo un administrador puede consultar reportes operativos globales.',
  }

  return knownMessages[error.message] ?? error.message
}

function describeLocalSyncHealth(
  queueSnapshot: Pick<SyncQueueSnapshot, 'failed' | 'pending' | 'processing'>,
) {
  if (queueSnapshot.failed > 0) {
    return {
      label: `${queueSnapshot.failed} con error`,
      summary: `${queueSnapshot.pending} pendiente(s) y ${queueSnapshot.processing} en envío en este dispositivo.`,
      tone: 'danger',
    }
  }

  if (queueSnapshot.pending > 0 || queueSnapshot.processing > 0) {
    return {
      label: `${queueSnapshot.pending + queueSnapshot.processing} en cola`,
      summary: `La cola local aún tiene ${queueSnapshot.pending} pendiente(s) y ${queueSnapshot.processing} en envío.`,
      tone: 'warning',
    }
  }

  return {
    label: 'Sin divergencias',
    summary: 'La cola local de este dispositivo no tiene eventos pendientes ni fallidos.',
    tone: 'success',
  }
}

function describeLoanStatus(status: LoanStatus) {
  const labels: Record<LoanStatus, string> = {
    active: 'Activo',
    canceled: 'Cancelado',
    delinquent: 'Mora',
    draft: 'Borrador',
    settled: 'Pagado',
    written_off: 'Incobrable',
  }

  return labels[status]
}

function formatReportDate(date: string) {
  return new Intl.DateTimeFormat(env.defaultLocale, {
    day: '2-digit',
    month: 'short',
    timeZone: FINANCIAL_BASELINE.businessTimezone,
  }).format(new Date(`${date}T00:00:00`))
}

function formatReportTimestamp(timestamp: string) {
  return new Intl.DateTimeFormat(env.defaultLocale, {
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    timeZone: FINANCIAL_BASELINE.businessTimezone,
  }).format(new Date(timestamp))
}
