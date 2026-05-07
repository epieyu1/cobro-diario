import type { SupabaseClient } from '@supabase/supabase-js'
import { mapOperationalReportResponse } from '@/lib/reports/report-mappers.ts'
import type { OperationalReportFilters, OperationalReportSnapshot } from '@/lib/reports/report-types.ts'
import { REPORTABLE_LOAN_STATUSES } from '@/lib/reports/report-types.ts'
import type { LoanStatus } from '@/types/domain.ts'

export type OperationalReportTransport = {
  getOperationalReport(filters?: OperationalReportFilters): Promise<OperationalReportSnapshot>
}

type NormalizedOperationalReportFilters = {
  collectorId?: string
  loanStatus?: LoanStatus
  routeLabel?: string
}

// Intencion: encapsular la lectura admin de reportes en un solo contrato de transporte.
// Flujo: filtros visibles por UI -> RPC protegido por RLS -> mapper estricto -> panel admin.
// Riesgo: si la UI consulta tablas sueltas para construir métricas, cada pantalla puede
// terminar con cifras distintas o reabrir lecturas fuera del alcance previsto.
export function createSupabaseOperationalReportTransport(
  supabaseClient: SupabaseClient,
): OperationalReportTransport {
  return {
    async getOperationalReport(filters) {
      const normalizedFilters = normalizeOperationalReportFilters(filters)
      const { data, error } = await supabaseClient.rpc('get_operational_report', {
        p_collector_id: normalizedFilters.collectorId ?? null,
        p_loan_status: normalizedFilters.loanStatus ?? null,
        p_route_label: normalizedFilters.routeLabel ?? null,
      })

      if (error) {
        throw new Error(error.message)
      }

      return mapOperationalReportResponse(data)
    },
  }
}

export function normalizeOperationalReportFilters(
  filters: OperationalReportFilters = {},
): NormalizedOperationalReportFilters {
  const collectorId = normalizeOptionalFilter(filters.collectorId)
  const routeLabel = normalizeOptionalFilter(filters.routeLabel)
  const loanStatus = normalizeOptionalLoanStatus(filters.loanStatus)

  return {
    collectorId,
    loanStatus,
    routeLabel,
  }
}

function normalizeOptionalFilter(value: string | undefined) {
  const normalizedValue = value?.trim()
  return normalizedValue ? normalizedValue : undefined
}

function normalizeOptionalLoanStatus(value: LoanStatus | undefined) {
  if (!value) {
    return undefined
  }

  if (!REPORTABLE_LOAN_STATUSES.includes(value)) {
    throw new Error('loan_status_invalid')
  }

  return value
}
