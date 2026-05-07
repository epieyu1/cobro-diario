import { describe, expect, it } from 'vitest'
import { mapOperationalReportResponse } from '@/lib/reports/report-mappers.ts'

describe('mapOperationalReportResponse', () => {
  it('normalizes the admin report payload returned by the RPC', () => {
    const report = mapOperationalReportResponse({
      businessDate: '2026-05-06',
      collectors: [
        {
          collectedTodayAmount: 75000,
          collectorId: 'collector-1',
          collectorName: 'Laura Diaz',
          customerCount: 4,
          dueTodayLoanCount: 2,
          openLoanCount: 3,
          outstandingAmount: '240000',
          overdueLoanCount: 1,
        },
      ],
      filters: {
        collectorId: null,
        loanStatus: 'active',
        routeLabel: 'Ruta Centro',
      },
      generatedAt: '2026-05-06T20:00:00.000Z',
      metrics: {
        collectedTodayAmount: '95000',
        collectedTodayCount: 3,
        customerCount: 5,
        dueTodayLoanCount: 2,
        openLoanCount: 4,
        outstandingAmount: '355000',
        overdueLoanCount: 1,
      },
      routes: [
        {
          collectedTodayAmount: '55000',
          customerCount: 3,
          dueTodayLoanCount: 1,
          openLoanCount: 2,
          outstandingAmount: '120000',
          overdueLoanCount: 1,
          routeLabel: 'Ruta Centro',
        },
      ],
      statuses: [
        {
          loanCount: 4,
          outstandingAmount: '355000',
          status: 'active',
        },
      ],
    })

    expect(report).toEqual({
      businessDate: '2026-05-06',
      collectors: [
        {
          collectedTodayAmount: '75000.00',
          collectorId: 'collector-1',
          collectorName: 'Laura Diaz',
          customerCount: 4,
          dueTodayLoanCount: 2,
          openLoanCount: 3,
          outstandingAmount: '240000.00',
          overdueLoanCount: 1,
        },
      ],
      filters: {
        collectorId: undefined,
        loanStatus: 'active',
        routeLabel: 'Ruta Centro',
      },
      generatedAt: '2026-05-06T20:00:00.000Z',
      metrics: {
        collectedTodayAmount: '95000.00',
        collectedTodayCount: 3,
        customerCount: 5,
        dueTodayLoanCount: 2,
        openLoanCount: 4,
        outstandingAmount: '355000.00',
        overdueLoanCount: 1,
      },
      routes: [
        {
          collectedTodayAmount: '55000.00',
          customerCount: 3,
          dueTodayLoanCount: 1,
          openLoanCount: 2,
          outstandingAmount: '120000.00',
          overdueLoanCount: 1,
          routeLabel: 'Ruta Centro',
        },
      ],
      statuses: [
        {
          loanCount: 4,
          outstandingAmount: '355000.00',
          status: 'active',
        },
      ],
    })
  })

  it('fails fast when the report payload is malformed', () => {
    expect(() =>
      mapOperationalReportResponse({
        businessDate: '2026-05-06',
        collectors: [],
        filters: {},
        generatedAt: '2026-05-06T20:00:00.000Z',
        metrics: {
          collectedTodayAmount: '100.00',
        },
        routes: [],
        statuses: [],
      }),
    ).toThrow('invalid_operational_report')
  })
})
