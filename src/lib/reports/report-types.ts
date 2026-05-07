import type { LoanStatus } from '@/types/domain.ts'

export const REPORTABLE_LOAN_STATUSES: LoanStatus[] = [
  'draft',
  'active',
  'delinquent',
  'settled',
  'written_off',
  'canceled',
]

export type OperationalReportFilters = {
  collectorId?: string
  loanStatus?: LoanStatus
  routeLabel?: string
}

export type OperationalReportMetrics = {
  collectedTodayAmount: string
  collectedTodayCount: number
  customerCount: number
  dueTodayLoanCount: number
  openLoanCount: number
  outstandingAmount: string
  overdueLoanCount: number
}

export type OperationalReportCollectorSummary = {
  collectedTodayAmount: string
  collectorId: string
  collectorName: string
  customerCount: number
  dueTodayLoanCount: number
  openLoanCount: number
  outstandingAmount: string
  overdueLoanCount: number
}

export type OperationalReportRouteSummary = {
  collectedTodayAmount: string
  customerCount: number
  dueTodayLoanCount: number
  openLoanCount: number
  outstandingAmount: string
  overdueLoanCount: number
  routeLabel: string
}

export type OperationalReportStatusSummary = {
  loanCount: number
  outstandingAmount: string
  status: LoanStatus
}

export type OperationalReportSnapshot = {
  businessDate: string
  collectors: OperationalReportCollectorSummary[]
  filters: OperationalReportFilters
  generatedAt: string
  metrics: OperationalReportMetrics
  routes: OperationalReportRouteSummary[]
  statuses: OperationalReportStatusSummary[]
}
