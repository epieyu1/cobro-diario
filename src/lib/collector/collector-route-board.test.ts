import { describe, expect, it } from 'vitest'
import { buildCollectorRouteBoard } from '@/lib/collector/collector-route-board.ts'
import type { CollectorLoanCard } from '@/lib/collector/collector-workspace.ts'

describe('collector route board', () => {
  it('prefers the persisted route label before falling back to neighborhood or address', () => {
    const routeBoard = buildCollectorRouteBoard(
      [
        buildLoanCard({
          customer: {
            address: 'Cra 10 #20-30 · Centro',
            routeLabel: 'Ruta Norte',
          },
          failedSyncCount: 0,
          loanId: 'loan-ruta-norte',
          nextDueDate: '2026-05-05',
          overdueInstallmentCount: 0,
          outstandingAmount: '80000.00',
          payableInstallmentCount: 1,
        }),
        buildLoanCard({
          customer: {
            neighborhood: 'Galerias',
          },
          failedSyncCount: 1,
          loanId: 'loan-galerias',
          nextDueDate: '2026-05-08',
          overdueInstallmentCount: 0,
          outstandingAmount: '50000.00',
          payableInstallmentCount: 1,
        }),
      ],
      {
        businessDate: '2026-05-05',
      },
    )

    expect(routeBoard.routes.map((route) => route.routeLabel)).toEqual(['Galerias', 'Ruta Norte'])
    expect(routeBoard.cards[0]).toMatchObject({
      priority: 'sync-failed',
      routeLabel: 'Galerias',
    })
    expect(routeBoard.cards[1]).toMatchObject({
      priority: 'due-today',
      routeLabel: 'Ruta Norte',
    })
    expect(routeBoard.metrics).toMatchObject({
      dueTodayLoanCount: 1,
      failedSyncLoanCount: 1,
      openLoanCount: 2,
      overdueLoanCount: 0,
    })
  })

  it('marks overdue loans ahead of scheduled loans and falls back to route without zone', () => {
    const routeBoard = buildCollectorRouteBoard(
      [
        buildLoanCard({
          failedSyncCount: 0,
          loanId: 'loan-overdue',
          overdueInstallmentCount: 2,
          outstandingAmount: '120000.00',
          payableInstallmentCount: 2,
        }),
        buildLoanCard({
          failedSyncCount: 0,
          loanId: 'loan-settled',
          outstandingAmount: '0.00',
          payableInstallmentCount: 0,
        }),
      ],
      {
        businessDate: '2026-05-05',
      },
    )

    expect(routeBoard.cards[0]).toMatchObject({
      priority: 'overdue',
      routeLabel: 'Ruta sin zona',
    })
    expect(routeBoard.cards[1]).toMatchObject({
      priority: 'settled',
      routeLabel: 'Ruta sin zona',
    })
    expect(routeBoard.routes[0]).toMatchObject({
      highestPriority: 'overdue',
      routeLabel: 'Ruta sin zona',
    })
  })

  it('builds a simulated large route board without degrading the operational sort', () => {
    const largeLoanSet = Array.from({ length: 1200 }, (_, index) =>
      buildLoanCard({
        customer: {
          address: index % 4 === 0 ? `Cra ${index} # 10-20 · Zona ${index % 18}` : undefined,
          fullName: `Cliente ${index.toString().padStart(4, '0')}`,
          neighborhood: index % 4 === 0 ? undefined : `Zona ${index % 18}`,
        },
        failedSyncCount: index % 37 === 0 ? 1 : 0,
        loanId: `loan-${index}`,
        nextDueDate: index % 3 === 0 ? '2026-05-05' : `2026-05-${String((index % 20) + 1).padStart(2, '0')}`,
        overdueInstallmentCount: index % 9 === 0 ? 2 : 0,
        outstandingAmount: index % 11 === 0 ? '0.00' : '85000.00',
        payableInstallmentCount: index % 11 === 0 ? 0 : 2,
        pendingSyncCount: index % 13 === 0 ? 1 : 0,
      }),
    )

    const startedAt = performance.now()
    const routeBoard = buildCollectorRouteBoard(largeLoanSet, {
      businessDate: '2026-05-05',
    })
    const elapsedMs = performance.now() - startedAt

    expect(routeBoard.cards).toHaveLength(1200)
    expect(routeBoard.routes).toHaveLength(18)
    expect(routeBoard.metrics.failedSyncLoanCount).toBeGreaterThan(0)
    expect(routeBoard.metrics.overdueLoanCount).toBeGreaterThan(0)
    expect(routeBoard.metrics.openLoanCount).toBeLessThan(1200)
    expect(routeBoard.cards[0]?.priority).toBe('sync-failed')
    expect(elapsedMs).toBeLessThan(400)
  })
})

function buildLoanCard(
  overrides: Partial<{
    customer: Partial<CollectorLoanCard['customer']>
    failedSyncCount: number
    latestPaymentId: string
    loanId: string
    nextDueDate: string
    overdueInstallmentCount: number
    outstandingAmount: string
    payableInstallmentCount: number
    pendingSyncCount: number
  }> = {},
): CollectorLoanCard {
  const customerOverrides = overrides.customer ?? {}

  return {
    customer: {
      address: customerOverrides.address,
      assignedCollectorId: 'collector-1',
      fullName: customerOverrides.fullName ?? 'Ana Gomez',
      governmentId: customerOverrides.governmentId,
      id: customerOverrides.id ?? 'customer-1',
      latitude: customerOverrides.latitude,
      longitude: customerOverrides.longitude,
      neighborhood: customerOverrides.neighborhood,
      phone: customerOverrides.phone,
      routeLabel: customerOverrides.routeLabel,
      updatedAt: '2026-05-05T12:00:00.000Z',
    },
    failedSyncCount: overrides.failedSyncCount ?? 0,
    installments: [],
    latestPayment: overrides.latestPaymentId
      ? {
          collectorId: 'collector-1',
          customerId: 'customer-1',
          deviceLocalId: overrides.latestPaymentId,
          id: overrides.latestPaymentId,
          loanId: overrides.loanId ?? 'loan-1',
          paidAt: '2026-05-05T12:00:00.000Z',
          paymentMethod: 'cash',
          syncStatus: 'synced',
          totalAmount: '10000.00',
          updatedAt: '2026-05-05T12:00:00.000Z',
        }
      : undefined,
    loan: {
      collectorId: 'collector-1',
      currencyCode: 'COP',
      customerId: 'customer-1',
      id: overrides.loanId ?? 'loan-1',
      installmentAmount: '50000.00',
      interestRateDaily: '0.000000',
      principalAmount: '200000.00',
      status: 'active',
      updatedAt: '2026-05-05T12:00:00.000Z',
    },
    nextDueDate: overrides.nextDueDate,
    outstandingAmount: overrides.outstandingAmount ?? '50000.00',
    overdueInstallmentCount: overrides.overdueInstallmentCount ?? 0,
    payableInstallmentCount: overrides.payableInstallmentCount ?? 1,
    pendingSyncCount: overrides.pendingSyncCount ?? 0,
  }
}
