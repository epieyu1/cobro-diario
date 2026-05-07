import { MONEY_DECIMAL_SCALE, toMoney } from '@/lib/finance/money.ts'
import {
  REPORTABLE_LOAN_STATUSES,
  type OperationalReportCollectorSummary,
  type OperationalReportFilters,
  type OperationalReportMetrics,
  type OperationalReportRouteSummary,
  type OperationalReportSnapshot,
  type OperationalReportStatusSummary,
} from '@/lib/reports/report-types.ts'
import type { LoanStatus } from '@/types/domain.ts'

// Intencion: validar de forma estricta el payload del RPC de reportes antes de tocar UI.
// Flujo: JSON remoto -> mapper estricto -> panel admin.
// Riesgo: si el contrato cambia silenciosamente, el dashboard puede mezclar montos,
// filtros o conteos sin que el navegador lo note.
export function mapOperationalReportResponse(payload: unknown): OperationalReportSnapshot {
  const root = expectObject(payload)

  return {
    businessDate: expectDate(root.businessDate),
    collectors: expectArray(root.collectors).map(mapCollectorSummary),
    filters: mapReportFilters(root.filters),
    generatedAt: expectIsoTimestamp(root.generatedAt),
    metrics: mapMetrics(root.metrics),
    routes: expectArray(root.routes).map(mapRouteSummary),
    statuses: expectArray(root.statuses).map(mapStatusSummary),
  }
}

function mapReportFilters(payload: unknown): OperationalReportFilters {
  const filters = expectObject(payload)

  return {
    collectorId: expectOptionalString(filters.collectorId),
    loanStatus: expectOptionalLoanStatus(filters.loanStatus),
    routeLabel: expectOptionalString(filters.routeLabel),
  }
}

function mapMetrics(payload: unknown): OperationalReportMetrics {
  const metrics = expectObject(payload)

  return {
    collectedTodayAmount: expectMoney(metrics.collectedTodayAmount),
    collectedTodayCount: expectInteger(metrics.collectedTodayCount),
    customerCount: expectInteger(metrics.customerCount),
    dueTodayLoanCount: expectInteger(metrics.dueTodayLoanCount),
    openLoanCount: expectInteger(metrics.openLoanCount),
    outstandingAmount: expectMoney(metrics.outstandingAmount),
    overdueLoanCount: expectInteger(metrics.overdueLoanCount),
  }
}

function mapCollectorSummary(payload: unknown): OperationalReportCollectorSummary {
  const summary = expectObject(payload)

  return {
    collectedTodayAmount: expectMoney(summary.collectedTodayAmount),
    collectorId: expectString(summary.collectorId),
    collectorName: expectString(summary.collectorName),
    customerCount: expectInteger(summary.customerCount),
    dueTodayLoanCount: expectInteger(summary.dueTodayLoanCount),
    openLoanCount: expectInteger(summary.openLoanCount),
    outstandingAmount: expectMoney(summary.outstandingAmount),
    overdueLoanCount: expectInteger(summary.overdueLoanCount),
  }
}

function mapRouteSummary(payload: unknown): OperationalReportRouteSummary {
  const summary = expectObject(payload)

  return {
    collectedTodayAmount: expectMoney(summary.collectedTodayAmount),
    customerCount: expectInteger(summary.customerCount),
    dueTodayLoanCount: expectInteger(summary.dueTodayLoanCount),
    openLoanCount: expectInteger(summary.openLoanCount),
    outstandingAmount: expectMoney(summary.outstandingAmount),
    overdueLoanCount: expectInteger(summary.overdueLoanCount),
    routeLabel: expectString(summary.routeLabel),
  }
}

function mapStatusSummary(payload: unknown): OperationalReportStatusSummary {
  const summary = expectObject(payload)

  return {
    loanCount: expectInteger(summary.loanCount),
    outstandingAmount: expectMoney(summary.outstandingAmount),
    status: expectLoanStatus(summary.status),
  }
}

function expectArray(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error('invalid_operational_report')
  }

  return value
}

function expectObject(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('invalid_operational_report')
  }

  return value as Record<string, unknown>
}

function expectString(value: unknown) {
  if (typeof value !== 'string') {
    throw new Error('invalid_operational_report')
  }

  const normalizedValue = value.trim()

  if (!normalizedValue) {
    throw new Error('invalid_operational_report')
  }

  return normalizedValue
}

function expectOptionalString(value: unknown) {
  if (value === null || value === undefined) {
    return undefined
  }

  return expectString(value)
}

function expectInteger(value: unknown) {
  const normalizedValue = typeof value === 'number' ? value : Number(value)

  if (!Number.isInteger(normalizedValue)) {
    throw new Error('invalid_operational_report')
  }

  return normalizedValue
}

function expectMoney(value: unknown) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('invalid_operational_report')
  }

  return toMoney(value).toFixed(MONEY_DECIMAL_SCALE)
}

function expectDate(value: unknown) {
  const normalizedValue = expectString(value)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedValue)) {
    throw new Error('invalid_operational_report')
  }

  return normalizedValue
}

function expectIsoTimestamp(value: unknown) {
  const normalizedValue = expectString(value)

  if (Number.isNaN(new Date(normalizedValue).getTime())) {
    throw new Error('invalid_operational_report')
  }

  return normalizedValue
}

function expectOptionalLoanStatus(value: unknown) {
  if (value === null || value === undefined) {
    return undefined
  }

  return expectLoanStatus(value)
}

function expectLoanStatus(value: unknown): LoanStatus {
  const normalizedValue = expectString(value)

  if (!REPORTABLE_LOAN_STATUSES.includes(normalizedValue as LoanStatus)) {
    throw new Error('invalid_operational_report')
  }

  return normalizedValue as LoanStatus
}
