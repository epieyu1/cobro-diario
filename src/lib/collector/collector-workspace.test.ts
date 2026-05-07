import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalDb } from '@/lib/db/local-db.ts'
import {
  bootstrapCollectorWorkspace,
  createSupabaseCollectorWorkspaceSource,
  loadCollectorWorkspaceSnapshot,
  recordLocalCollectionAction,
  type CollectorWorkspaceRemoteSource,
  shouldRefreshSessionRoleClaim,
} from '@/lib/collector/collector-workspace.ts'

describe('collector workspace bootstrap', () => {
  const databaseNames: string[] = []

  afterEach(async () => {
    await Promise.all(
      databaseNames.splice(0).map(async (databaseName) => {
        const database = createLocalDb(databaseName)
        await database.delete()
      }),
    )
  })

  it('hydrates local cache from the remote workspace and derives outstanding component balances', async () => {
    const database = registerDatabase()
    const source: CollectorWorkspaceRemoteSource = {
      async fetchWorkspace() {
        return {
          customers: [
            {
              address_line: 'Cra 10 # 20-30',
              assigned_collector_id: 'collector-1',
              full_name: 'Ana Gomez',
              government_id: '1010',
              id: 'customer-1',
              latitude: '4.711',
              longitude: '-74.072',
              neighborhood: 'Centro',
              phone: '3000000000',
              updated_at: '2026-05-05T13:00:00.000Z',
            },
          ],
          fetchedAt: '2026-05-05T14:00:00.000Z',
          installments: [
            {
              due_date: '2026-05-01',
              fee_amount: '10.00',
              id: 'installment-1',
              installment_number: 1,
              interest_amount: '20.00',
              loan_id: 'loan-1',
              outstanding_amount: '65.00',
              principal_amount: '70.00',
              scheduled_amount: '100.00',
              status: 'partial',
              updated_at: '2026-05-05T13:00:00.000Z',
            },
          ],
          loans: [
            {
              collector_id: 'collector-1',
              currency_code: 'COP',
              customer_id: 'customer-1',
              disbursement_date: '2026-05-05',
              external_loan_number: 'CD-20260505-LOAN0001',
              first_due_date: '2026-05-01',
              id: 'loan-1',
              installment_amount: '100.00',
              interest_mode: 'simple_precomputed',
              interest_rate_daily: '0.0000',
              notes: 'Prestamo originado desde LANDING.',
              originated_at: '2026-05-05T12:00:00.000Z',
              payment_application_mode: 'oldest_first',
              payment_frequency: 'weekly',
              principal_amount: '100.00',
              status: 'active',
              total_installments: 1,
              updated_at: '2026-05-05T13:00:00.000Z',
            },
          ],
          profile: {
            full_name: 'Laura Diaz',
            id: 'collector-1',
            role: 'collector',
          },
        }
      },
    }

    await bootstrapCollectorWorkspace(source, 'collector-1', {
      db: database,
    })

    const installment = await database.installments.get('installment-1')
    const snapshot = await loadCollectorWorkspaceSnapshot('collector-1', {
      db: database,
    })

    expect(installment).toMatchObject({
      outstandingAmount: '65.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '0.00',
      outstandingPrincipalAmount: '65.00',
    })
    expect(snapshot.profile).toEqual({
      fullName: 'Laura Diaz',
      id: 'collector-1',
      role: 'collector',
    })
    expect(snapshot.customerCount).toBe(1)
    expect(snapshot.openLoanCount).toBe(1)
    expect(snapshot.loanCards[0]).toMatchObject({
      failedSyncCount: 0,
      loan: {
        disbursementDate: '2026-05-05',
        externalLoanNumber: 'CD-20260505-LOAN0001',
        firstDueDate: '2026-05-01',
        paymentFrequency: 'weekly',
        totalInstallments: 1,
      },
      outstandingAmount: '65.00',
      payableInstallmentCount: 1,
      pendingSyncCount: 0,
    })
  })

  it('ignores remote installments that do not belong to the collector loan snapshot', async () => {
    const database = registerDatabase()
    const source: CollectorWorkspaceRemoteSource = {
      async fetchWorkspace() {
        return {
          customers: [
            {
              address_line: 'Cra 10 # 20-30',
              assigned_collector_id: 'collector-1',
              full_name: 'Ana Gomez',
              government_id: '1010',
              id: 'customer-1',
              latitude: null,
              longitude: null,
              neighborhood: 'Centro',
              phone: '3000000000',
              updated_at: '2026-05-05T13:00:00.000Z',
            },
          ],
          fetchedAt: '2026-05-05T14:00:00.000Z',
          installments: [
            {
              due_date: '2026-05-01',
              fee_amount: '0.00',
              id: 'installment-1',
              installment_number: 1,
              interest_amount: '5.00',
              loan_id: 'loan-1',
              outstanding_amount: '45.00',
              principal_amount: '40.00',
              scheduled_amount: '45.00',
              status: 'pending',
              updated_at: '2026-05-05T13:00:00.000Z',
            },
            {
              due_date: '2026-05-02',
              fee_amount: '0.00',
              id: 'installment-orphan',
              installment_number: 1,
              interest_amount: '5.00',
              loan_id: 'loan-orphan',
              outstanding_amount: '45.00',
              principal_amount: '40.00',
              scheduled_amount: '45.00',
              status: 'pending',
              updated_at: '2026-05-05T13:00:00.000Z',
            },
          ],
          loans: [
            {
              collector_id: 'collector-1',
              currency_code: 'COP',
              customer_id: 'customer-1',
              disbursement_date: '2026-05-01',
              external_loan_number: 'CD-20260501-LOAN0001',
              first_due_date: '2026-05-01',
              id: 'loan-1',
              installment_amount: '45.00',
              interest_mode: 'simple_precomputed',
              interest_rate_daily: '0.0000',
              notes: null,
              originated_at: '2026-05-01T08:00:00.000Z',
              payment_application_mode: 'oldest_first',
              payment_frequency: 'daily',
              principal_amount: '40.00',
              status: 'active',
              total_installments: 1,
              updated_at: '2026-05-05T13:00:00.000Z',
            },
          ],
          profile: {
            full_name: 'Laura Diaz',
            id: 'collector-1',
            role: 'collector',
          },
        }
      },
    }

    await bootstrapCollectorWorkspace(source, 'collector-1', {
      db: database,
    })

    const storedInstallments = await database.installments.toArray()
    const snapshot = await loadCollectorWorkspaceSnapshot('collector-1', {
      db: database,
    })

    expect(storedInstallments.map((installment) => installment.id)).toEqual(['installment-1'])
    expect(snapshot.loanCards[0]?.installments.map((installment) => installment.id)).toEqual(['installment-1'])
  })

  it('surfaces queue counts and latest payment per loan in the snapshot', async () => {
    const database = registerDatabase()

    await database.profiles.put({
      fullName: 'Laura Diaz',
      id: 'collector-1',
      role: 'collector',
    })
    await database.customers.put({
      assignedCollectorId: 'collector-1',
      fullName: 'Ana Gomez',
      id: 'customer-1',
      updatedAt: '2026-05-05T13:00:00.000Z',
    })
    await database.loans.put({
      collectorId: 'collector-1',
      currencyCode: 'COP',
      customerId: 'customer-1',
      id: 'loan-1',
      installmentAmount: '100.00',
      interestRateDaily: '0.0000',
      principalAmount: '300.00',
      status: 'active',
      updatedAt: '2026-05-05T13:00:00.000Z',
    })
    await database.installments.put({
      dueDate: '2026-05-01',
      feeAmount: '0.00',
      id: 'installment-1',
      installmentNumber: 1,
      interestAmount: '10.00',
      loanId: 'loan-1',
      outstandingAmount: '50.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '10.00',
      outstandingPrincipalAmount: '40.00',
      principalAmount: '40.00',
      scheduledAmount: '50.00',
      status: 'pending',
      updatedAt: '2026-05-05T13:00:00.000Z',
    })
    await database.payments.bulkPut([
      {
        collectorId: 'collector-1',
        customerId: 'customer-1',
        deviceLocalId: 'payment-1',
        id: 'payment-1',
        loanId: 'loan-1',
        paidAt: '2026-05-05T14:00:00.000Z',
        paymentMethod: 'cash',
        syncStatus: 'failed',
        totalAmount: '25.00',
        updatedAt: '2026-05-05T14:00:00.000Z',
      },
      {
        collectorId: 'collector-1',
        customerId: 'customer-1',
        deviceLocalId: 'payment-2',
        id: 'payment-2',
        loanId: 'loan-1',
        paidAt: '2026-05-05T15:00:00.000Z',
        paymentMethod: 'cash',
        syncStatus: 'pending',
        totalAmount: '10.00',
        updatedAt: '2026-05-05T15:00:00.000Z',
      },
    ])
    await database.syncQueue.bulkAdd([
      {
        attemptCount: 1,
        clientEventId: 'payment:payment-1:insert',
        createdAt: '2026-05-05T14:00:00.000Z',
        entityId: 'payment-1',
        entityName: 'payment',
        lastErrorCode: 'collector_not_allowed',
        lastErrorKind: 'conflict',
        lastErrorMessage: 'collector_not_allowed',
        operation: 'insert',
        payload: {},
        status: 'failed',
        updatedAt: '2026-05-05T14:00:00.000Z',
      },
      {
        attemptCount: 0,
        clientEventId: 'payment:payment-2:insert',
        createdAt: '2026-05-05T15:00:00.000Z',
        entityId: 'payment-2',
        entityName: 'payment',
        operation: 'insert',
        payload: {},
        status: 'pending',
        updatedAt: '2026-05-05T15:00:00.000Z',
      },
    ])

    const snapshot = await loadCollectorWorkspaceSnapshot('collector-1', {
      db: database,
    })

    expect(snapshot.queueEntries).toHaveLength(2)
    expect(snapshot.recentPayments[0]?.id).toBe('payment-2')
    expect(snapshot.loanCards[0]).toMatchObject({
      failedSyncCount: 1,
      pendingSyncCount: 1,
    })
    expect(snapshot.loanCards[0]?.latestPayment?.id).toBe('payment-2')
  })

  it('persists local collection actions and exposes the latest one per loan', async () => {
    const database = registerDatabase()

    await database.profiles.put({
      fullName: 'Laura Diaz',
      id: 'collector-1',
      role: 'collector',
    })
    await database.customers.put({
      assignedCollectorId: 'collector-1',
      fullName: 'Ana Gomez',
      id: 'customer-1',
      updatedAt: '2026-05-05T13:00:00.000Z',
    })
    await database.loans.put({
      collectorId: 'collector-1',
      currencyCode: 'COP',
      customerId: 'customer-1',
      id: 'loan-1',
      installmentAmount: '100.00',
      interestRateDaily: '0.0000',
      principalAmount: '300.00',
      status: 'active',
      updatedAt: '2026-05-05T13:00:00.000Z',
    })

    await recordLocalCollectionAction(
      {
        collectorId: 'collector-1',
        customerId: 'customer-1',
        followUpAt: '2026-05-06',
        loanId: 'loan-1',
        notes: 'Confirma pago en la tarde.',
        outcome: 'promise_to_pay',
      },
      {
        db: database,
        now: () => '2026-05-05T17:00:00.000Z',
      },
    )

    const snapshot = await loadCollectorWorkspaceSnapshot('collector-1', {
      db: database,
    })

    expect(snapshot.recentCollectionActions).toHaveLength(1)
    expect(snapshot.loanCards[0]?.latestCollectionAction).toMatchObject({
      followUpAt: '2026-05-06',
      notes: 'Confirma pago en la tarde.',
      outcome: 'promise_to_pay',
    })
  })

  it('shows aggregated admin workspace data when the local cache contains loans from another collector', async () => {
    const database = registerDatabase()

    await database.profiles.put({
      fullName: 'Fase 7 Admin',
      id: 'admin-1',
      role: 'admin',
    })
    await database.customers.put({
      assignedCollectorId: 'collector-2',
      fullName: 'Damian Customer',
      id: 'customer-remote-1',
      updatedAt: '2026-05-06T18:00:00.000Z',
    })
    await database.loans.put({
      collectorId: 'collector-2',
      currencyCode: 'COP',
      customerId: 'customer-remote-1',
      externalLoanNumber: 'CD-20260506-LOAN0099',
      id: 'loan-remote-1',
      installmentAmount: '80.00',
      interestRateDaily: '0.0000',
      principalAmount: '500.00',
      status: 'active',
      updatedAt: '2026-05-06T18:00:00.000Z',
    })
    await database.installments.put({
      dueDate: '2026-05-13',
      feeAmount: '0.00',
      id: 'installment-remote-1',
      installmentNumber: 1,
      interestAmount: '20.00',
      loanId: 'loan-remote-1',
      outstandingAmount: '80.00',
      outstandingFeeAmount: '0.00',
      outstandingInterestAmount: '20.00',
      outstandingPrincipalAmount: '60.00',
      principalAmount: '60.00',
      scheduledAmount: '80.00',
      status: 'pending',
      updatedAt: '2026-05-06T18:00:00.000Z',
    })

    const snapshot = await loadCollectorWorkspaceSnapshot('admin-1', {
      db: database,
    })

    expect(snapshot.profile).toEqual({
      fullName: 'Fase 7 Admin',
      id: 'admin-1',
      role: 'admin',
    })
    expect(snapshot.customerCount).toBe(1)
    expect(snapshot.openLoanCount).toBe(1)
    expect(snapshot.loanCards[0]).toMatchObject({
      customer: {
        fullName: 'Damian Customer',
      },
      loan: {
        collectorId: 'collector-2',
        externalLoanNumber: 'CD-20260506-LOAN0099',
      },
      outstandingAmount: '80.00',
    })
  })

  it('refreshes the browser session before reading aggregate admin workspace when the JWT role is stale', async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: {
        session: {
          user: {
            app_metadata: {
              role: 'collector',
            },
          },
        },
      },
      error: null,
    })
    const refreshSession = vi.fn().mockResolvedValue({
      data: {
        session: {
          user: {
            app_metadata: {
              role: 'admin',
            },
          },
        },
      },
      error: null,
    })
    const profileMaybeSingle = vi.fn().mockResolvedValue({
      data: {
        full_name: 'Fase 7 Admin',
        id: 'admin-1',
        role: 'admin',
      },
      error: null,
    })
    const customersOrder = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const loansOrder = vi.fn().mockResolvedValue({
      data: [],
      error: null,
    })
    const fakeSupabaseClient = {
      auth: {
        getSession,
        refreshSession,
      },
      from(table: string) {
        if (table === 'profiles') {
          return {
            select() {
              return {
                eq() {
                  return {
                    maybeSingle: profileMaybeSingle,
                  }
                },
              }
            },
          }
        }

        if (table === 'customers') {
          return {
            select() {
              return {
                is() {
                  return {
                    order: customersOrder,
                  }
                },
              }
            },
          }
        }

        if (table === 'loans') {
          return {
            select() {
              return {
                order: loansOrder,
              }
            },
          }
        }

        if (table === 'installments') {
          return {
            select() {
              return {
                in() {
                  return {
                    order() {
                      return {
                        order: vi.fn().mockResolvedValue({
                          data: [],
                          error: null,
                        }),
                      }
                    },
                  }
                },
              }
            },
          }
        }

        throw new Error(`unexpected_table:${table}`)
      },
    }

    await createSupabaseCollectorWorkspaceSource(fakeSupabaseClient as never).fetchWorkspace('admin-1')

    expect(getSession).toHaveBeenCalledTimes(1)
    expect(refreshSession).toHaveBeenCalledTimes(1)
    expect(customersOrder).toHaveBeenCalledTimes(1)
    expect(loansOrder).toHaveBeenCalledTimes(1)
  })

  function registerDatabase() {
    const databaseName = `collector-workspace-${crypto.randomUUID()}`
    databaseNames.push(databaseName)

    return createLocalDb(databaseName)
  }
})

describe('session role claim refresh policy', () => {
  it('refreshes when the remote profile role and the JWT claim diverge', () => {
    expect(shouldRefreshSessionRoleClaim('admin', 'collector')).toBe(true)
    expect(shouldRefreshSessionRoleClaim('collector', 'admin')).toBe(true)
  })

  it('does not refresh when the claim is aligned or missing', () => {
    expect(shouldRefreshSessionRoleClaim('admin', 'admin')).toBe(false)
    expect(shouldRefreshSessionRoleClaim('collector', 'collector')).toBe(false)
    expect(shouldRefreshSessionRoleClaim('admin', null)).toBe(false)
    expect(shouldRefreshSessionRoleClaim(null, 'collector')).toBe(false)
  })
})
