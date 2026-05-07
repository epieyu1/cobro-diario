import { describe, expect, it, vi } from 'vitest'
import {
  createSupabaseOperationalReportTransport,
  normalizeOperationalReportFilters,
} from '@/lib/reports/report-queries.ts'

type MockTransportClient = Parameters<typeof createSupabaseOperationalReportTransport>[0]

describe('normalizeOperationalReportFilters', () => {
  it('trims empty filters before touching Supabase', () => {
    expect(
      normalizeOperationalReportFilters({
        collectorId: ' collector-1 ',
        loanStatus: 'delinquent',
        routeLabel: '  Ruta Centro  ',
      }),
    ).toEqual({
      collectorId: 'collector-1',
      loanStatus: 'delinquent',
      routeLabel: 'Ruta Centro',
    })
  })

  it('rejects unknown loan status filters', () => {
    expect(() =>
      normalizeOperationalReportFilters({
        loanStatus: 'unknown' as never,
      }),
    ).toThrow('loan_status_invalid')
  })
})

describe('createSupabaseOperationalReportTransport', () => {
  it('reads the admin report through the RPC contract', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        businessDate: '2026-05-06',
        collectors: [],
        filters: {},
        generatedAt: '2026-05-06T20:00:00.000Z',
        metrics: {
          collectedTodayAmount: '100.00',
          collectedTodayCount: 1,
          customerCount: 2,
          dueTodayLoanCount: 1,
          openLoanCount: 2,
          outstandingAmount: '200.00',
          overdueLoanCount: 0,
        },
        routes: [],
        statuses: [],
      },
      error: null,
    })
    const transport = createSupabaseOperationalReportTransport({
      rpc,
    } as unknown as MockTransportClient)

    const report = await transport.getOperationalReport({
      collectorId: ' collector-1 ',
      loanStatus: 'active',
      routeLabel: ' Ruta Centro ',
    })

    expect(rpc).toHaveBeenCalledWith('get_operational_report', {
      p_collector_id: 'collector-1',
      p_loan_status: 'active',
      p_route_label: 'Ruta Centro',
    })
    expect(report.metrics).toEqual({
      collectedTodayAmount: '100.00',
      collectedTodayCount: 1,
      customerCount: 2,
      dueTodayLoanCount: 1,
      openLoanCount: 2,
      outstandingAmount: '200.00',
      overdueLoanCount: 0,
    })
  })

  it('fails fast when the RPC returns a malformed payload', async () => {
    const transport = createSupabaseOperationalReportTransport({
      rpc: vi.fn().mockResolvedValue({
        data: {
          businessDate: '2026-05-06',
        },
        error: null,
      }),
    } as unknown as MockTransportClient)

    await expect(transport.getOperationalReport()).rejects.toThrow('invalid_operational_report')
  })
})
