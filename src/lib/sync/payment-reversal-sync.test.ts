import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalDb } from '@/lib/db/local-db.ts'
import {
  createSupabasePaymentReversalTransport,
  reconcileLocalPaymentReceipt,
} from '@/lib/sync/payment-reversal-sync.ts'

describe('payment reversal sync helpers', () => {
  const databaseNames: string[] = []

  function registerDatabase() {
    const databaseName = `payment-reversal-sync-${crypto.randomUUID()}`
    const database = createLocalDb(databaseName)
    databaseNames.push(databaseName)

    return database
  }

  afterEach(async () => {
    await Promise.all(
      databaseNames.splice(0).map(async (databaseName) => {
        const database = createLocalDb(databaseName)
        await database.delete()
      }),
    )
  })

  it('calls reverse_payment and maps the confirmed receipt payload', async () => {
    const supabaseClient = {
      rpc: vi.fn(async () => ({
        data: {
          applications: [],
          collector: {
            fullName: 'Laura Diaz',
            id: 'collector-1',
          },
          collectorId: 'collector-1',
          createdAt: '2026-05-07T05:10:00.000Z',
          customer: {
            fullName: 'Cliente Uno',
            id: 'customer-1',
          },
          deviceLocalId: 'device-local-1',
          loan: {
            currencyCode: 'COP',
            id: 'loan-1',
          },
          paidAt: '2026-05-07T05:00:00.000Z',
          paymentId: 'payment-1',
          paymentMethod: 'cash',
          reversal: {
            reason: 'Cobro duplicado',
            reversedAt: '2026-05-07T05:10:00.000Z',
            reversedBy: {
              fullName: 'Admin Uno',
              id: 'admin-1',
            },
          },
          status: 'reversed',
          totalAmount: '50.00',
        },
        error: null,
      })),
    }

    const transport = createSupabasePaymentReversalTransport(
      supabaseClient as never,
    )
    const reversedReceipt = await transport.reversePayment({
      paymentId: 'payment-1',
      reversalReason: 'Cobro duplicado',
    })

    expect(supabaseClient.rpc).toHaveBeenCalledWith('reverse_payment', {
      p_payment_id: 'payment-1',
      p_reversal_reason: 'Cobro duplicado',
    })
    expect(reversedReceipt).toMatchObject({
      paymentId: 'payment-1',
      reversal: {
        reason: 'Cobro duplicado',
      },
      status: 'reversed',
    })
  })

  it('patches local payment status after a confirmed reversal', async () => {
    const database = registerDatabase()

    await database.payments.put({
      collectorId: 'collector-1',
      customerId: 'customer-1',
      deviceLocalId: 'device-local-1',
      id: 'payment-local-1',
      loanId: 'loan-1',
      paidAt: '2026-05-07T05:00:00.000Z',
      paymentMethod: 'cash',
      remotePaymentId: 'payment-1',
      remotePaymentStatus: 'posted',
      syncStatus: 'synced',
      totalAmount: '50.00',
      updatedAt: '2026-05-07T05:00:00.000Z',
    })

    const nextPayment = await reconcileLocalPaymentReceipt(
      'payment-local-1',
      {
        applications: [],
        collector: {
          fullName: 'Laura Diaz',
          id: 'collector-1',
        },
        collectorId: 'collector-1',
        createdAt: '2026-05-07T05:10:00.000Z',
        customer: {
          fullName: 'Cliente Uno',
          id: 'customer-1',
        },
        deviceLocalId: 'device-local-1',
        loan: {
          currencyCode: 'COP',
          id: 'loan-1',
        },
        paidAt: '2026-05-07T05:00:00.000Z',
        paymentId: 'payment-1',
        paymentMethod: 'cash',
        reversal: {
          reason: 'Cobro duplicado',
          reversedAt: '2026-05-07T05:10:00.000Z',
          reversedBy: {
            fullName: 'Admin Uno',
            id: 'admin-1',
          },
        },
        status: 'reversed',
        totalAmount: '50.00',
      },
      {
        db: database,
        now: () => '2026-05-07T05:11:00.000Z',
      },
    )

    const storedPayment = await database.payments.get('payment-local-1')

    expect(nextPayment).toMatchObject({
      remotePaymentId: 'payment-1',
      remotePaymentStatus: 'reversed',
      syncStatus: 'synced',
      updatedAt: '2026-05-07T05:11:00.000Z',
    })
    expect(storedPayment).toMatchObject({
      remotePaymentStatus: 'reversed',
      syncStatus: 'synced',
    })
  })
})
