import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assertNoSupabaseError, createPublicSupabaseClient } from './lib/supabase-public-client.mjs'
import {
  buildOldestFirstPaymentApplications,
  deriveOutstandingInstallmentComponents,
  toMoney,
} from './lib/financial-v1.mjs'
import {
  buildConfirmedReceiptPdfFilename,
  createConfirmedReceiptPdfBytes,
} from '../src/lib/receipts/receipt-pdf.ts'
import { deriveReceiptMetrics } from '../src/lib/receipts/receipt-analytics.ts'
import type { CollectorLoanCard } from '../src/lib/collector/collector-workspace.ts'
import type { ConfirmedPaymentReceipt } from '../src/lib/receipts/receipt-types.ts'

const usage = `Usage:
  node --experimental-strip-types scripts/phase5-receipt-pdf-smoke.ts <email> <password> [external-loan-number]
`

type ReceiptApplicationPayload = {
  appliedAmount?: unknown
  dueDate?: unknown
  feeComponent?: unknown
  installmentId?: unknown
  installmentNumber?: unknown
  interestComponent?: unknown
  principalComponent?: unknown
}

type ReceiptPayload = {
  applications?: ReceiptApplicationPayload[]
  collector?: {
    fullName?: unknown
    id?: unknown
  }
  collectorId?: unknown
  createdAt?: unknown
  customer?: {
    fullName?: unknown
    governmentId?: unknown
    id?: unknown
    phone?: unknown
  }
  deviceLocalId?: unknown
  loan?: {
    currencyCode?: unknown
    externalLoanNumber?: unknown
    id?: unknown
  }
  paidAt?: unknown
  paymentId?: unknown
  paymentMethod?: unknown
  paymentReference?: unknown
  reversal?: {
    reason?: unknown
    reversedAt?: unknown
    reversedBy?: {
      fullName?: unknown
      id?: unknown
    }
  }
  status?: unknown
  totalAmount?: unknown
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

async function main() {
  const email = process.argv[2]
  const password = process.argv[3]
  const externalLoanNumber = process.argv[4] || 'PG-ELI-001'

  if (!email || !password) {
    throw new Error(usage)
  }

  resetPlayground('before')

  try {
    const supabaseClient = createPublicSupabaseClient()
    const result = await withCollectorSession(supabaseClient, email, password, async (collectorId) => {
      const loanContextBeforePayment = await loadLoanContext(supabaseClient, externalLoanNumber)
      const normalizedInstallments = normalizeInstallmentRows(loanContextBeforePayment.installments)
      const firstCollectibleInstallment = normalizedInstallments.find(
        (installment) => installment.status !== 'paid' && installment.status !== 'canceled' && toMoney(installment.outstandingAmount).gt(0),
      )

      if (!firstCollectibleInstallment) {
        throw new Error(`playground_loan_not_collectible:${externalLoanNumber}`)
      }

      const applications = buildOldestFirstPaymentApplications(
        firstCollectibleInstallment.outstandingAmount,
        normalizedInstallments,
      )
      const deviceId = await loadFirstDeviceId(supabaseClient)
      const paymentReference = `PDF-${externalLoanNumber}-${Date.now()}`
      const paymentResult = await supabaseClient.rpc('record_payment', {
        p_applications: applications.map((application) => ({
          applied_amount: application.appliedAmount,
          fee_component: application.feeComponent,
          installment_id: application.installmentId,
          interest_component: application.interestComponent,
          principal_component: application.principalComponent,
        })),
        p_collector_id: collectorId,
        p_customer_id: loanContextBeforePayment.customer.id,
        p_device_id: deviceId,
        p_device_local_id: `pdf:${externalLoanNumber}:${Date.now()}:${randomUUID()}`,
        p_latitude: null,
        p_loan_id: loanContextBeforePayment.loan.id,
        p_longitude: null,
        p_notes: `Smoke PDF ${externalLoanNumber}`,
        p_paid_at: new Date().toISOString(),
        p_payment_method: 'cash',
        p_payment_reference: paymentReference,
      })
      assertNoSupabaseError('record_payment', paymentResult.error)

      if (typeof paymentResult.data !== 'string' || !paymentResult.data) {
        throw new Error('invalid_receipt_smoke_payment_id')
      }

      const receiptResult = await supabaseClient.rpc('get_payment_receipt', {
        p_payment_id: paymentResult.data,
      })
      assertNoSupabaseError('get_payment_receipt', receiptResult.error)

      const confirmedReceipt = normalizeConfirmedReceipt(receiptResult.data)
      const loanContextAfterPayment = await loadLoanContext(supabaseClient, externalLoanNumber)
      const loanCard = buildCollectorLoanCard(loanContextAfterPayment)
      const pdfBytes = await createConfirmedReceiptPdfBytes({
        appName: 'Cobro Diario',
        locale: 'es-CO',
        receipt: confirmedReceipt,
        summary: deriveReceiptMetrics(confirmedReceipt, loanCard),
      })
      const outputDirectory = join(tmpdir(), 'cobro-diario-receipt-smoke')
      mkdirSync(outputDirectory, { recursive: true })
      const filename = buildConfirmedReceiptPdfFilename(confirmedReceipt)
      const outputPath = join(outputDirectory, filename)
      writeFileSync(outputPath, Buffer.from(pdfBytes))
      const header = Buffer.from(pdfBytes.slice(0, 5)).toString('utf8')

      if (header !== '%PDF-') {
        throw new Error('receipt_pdf_header_invalid')
      }

      return {
        collectorId,
        externalLoanNumber,
        outputPath,
        paymentId: confirmedReceipt.paymentId,
        receiptReference: confirmedReceipt.paymentReference ?? null,
      }
    })

    console.log(JSON.stringify({ result: 'ok', ...result }, null, 2))
  } finally {
    resetPlayground('after')
  }
}

async function withCollectorSession(
  supabaseClient: ReturnType<typeof createPublicSupabaseClient>,
  email: string,
  password: string,
  callback: (collectorId: string) => Promise<unknown>,
) {
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  })
  assertNoSupabaseError('auth.signInWithPassword', error)

  try {
    const collectorId = data.user?.id

    if (!collectorId) {
      throw new Error('missing_authenticated_user')
    }

    return await callback(collectorId)
  } finally {
    await supabaseClient.auth.signOut()
  }
}

async function loadLoanContext(
  supabaseClient: ReturnType<typeof createPublicSupabaseClient>,
  externalLoanNumber: string,
) {
  const loanResult = await supabaseClient
    .from('loans')
    .select(
      'id, customer_id, collector_id, external_loan_number, principal_amount, installment_amount, total_installments, currency_code, status, updated_at',
    )
    .eq('external_loan_number', externalLoanNumber)
    .maybeSingle()
  assertNoSupabaseError('loans.single', loanResult.error)

  if (!loanResult.data) {
    throw new Error(`loan_not_found:${externalLoanNumber}`)
  }

  const [customerResult, installmentsResult] = await Promise.all([
    supabaseClient
      .from('customers')
      .select('id, assigned_collector_id, full_name, updated_at')
      .eq('id', loanResult.data.customer_id)
      .maybeSingle(),
    supabaseClient
      .from('installments')
      .select(
        'id, loan_id, installment_number, due_date, scheduled_amount, principal_amount, interest_amount, fee_amount, outstanding_amount, status, updated_at',
      )
      .eq('loan_id', loanResult.data.id)
      .order('due_date')
      .order('installment_number'),
  ])
  assertNoSupabaseError('customers.single', customerResult.error)
  assertNoSupabaseError('installments.by_loan', installmentsResult.error)

  if (!customerResult.data) {
    throw new Error(`loan_customer_not_found:${externalLoanNumber}`)
  }

  return {
    customer: customerResult.data,
    installments: installmentsResult.data ?? [],
    loan: loanResult.data,
  }
}

async function loadFirstDeviceId(supabaseClient: ReturnType<typeof createPublicSupabaseClient>) {
  const result = await supabaseClient
    .from('devices')
    .select('id')
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  assertNoSupabaseError('devices.first', result.error)

  return result.data?.id ?? null
}

function normalizeInstallmentRows(installments: Awaited<ReturnType<typeof loadLoanContext>>['installments']) {
  return installments.map((installment) => {
    const outstandingComponents = deriveOutstandingInstallmentComponents({
      feeAmount: installment.fee_amount,
      interestAmount: installment.interest_amount,
      outstandingAmount: installment.outstanding_amount,
      principalAmount: installment.principal_amount,
    })

    return {
      dueDate: installment.due_date,
      feeAmount: installment.fee_amount,
      id: installment.id,
      installmentNumber: installment.installment_number,
      interestAmount: installment.interest_amount,
      loanId: installment.loan_id,
      outstandingAmount: installment.outstanding_amount,
      outstandingFeeAmount: outstandingComponents.feeAmount,
      outstandingInterestAmount: outstandingComponents.interestAmount,
      outstandingPrincipalAmount: outstandingComponents.principalAmount,
      principalAmount: installment.principal_amount,
      scheduledAmount: installment.scheduled_amount,
      status: installment.status,
      updatedAt: installment.updated_at,
    }
  })
}

function buildCollectorLoanCard(
  loanContext: Awaited<ReturnType<typeof loadLoanContext>>,
): CollectorLoanCard {
  const installments = normalizeInstallmentRows(loanContext.installments)
  const nextDueInstallment = installments.find(
    (installment) => installment.status !== 'paid' && installment.status !== 'canceled' && toMoney(installment.outstandingAmount).gt(0),
  )

  return {
    customer: {
      assignedCollectorId: loanContext.customer.assigned_collector_id,
      fullName: loanContext.customer.full_name,
      id: loanContext.customer.id,
      updatedAt: loanContext.customer.updated_at,
    },
    failedSyncCount: 0,
    installments,
    latestPayment: undefined,
    loan: {
      collectorId: loanContext.loan.collector_id,
      currencyCode: loanContext.loan.currency_code,
      customerId: loanContext.loan.customer_id,
      externalLoanNumber: loanContext.loan.external_loan_number,
      id: loanContext.loan.id,
      installmentAmount: String(loanContext.loan.installment_amount),
      interestRateDaily: '0.000000',
      principalAmount: String(loanContext.loan.principal_amount),
      status: loanContext.loan.status,
      totalInstallments: loanContext.loan.total_installments,
      updatedAt: loanContext.loan.updated_at,
    },
    nextDueDate: nextDueInstallment?.dueDate,
    outstandingAmount: installments
      .reduce((total, installment) => total.plus(installment.outstandingAmount), toMoney(0))
      .toFixed(2),
    overdueInstallmentCount: installments.filter((installment) => installment.status === 'overdue').length,
    payableInstallmentCount: installments.filter(
      (installment) => installment.status !== 'paid' && installment.status !== 'canceled' && toMoney(installment.outstandingAmount).gt(0),
    ).length,
    pendingSyncCount: 0,
  }
}

function normalizeConfirmedReceipt(payload: unknown): ConfirmedPaymentReceipt {
  const receipt = payload as ReceiptPayload

  return {
    applications: (receipt.applications ?? []).map((application) => ({
      appliedAmount: toMoney(application.appliedAmount).toFixed(2),
      dueDate: String(application.dueDate),
      feeComponent: toMoney(application.feeComponent).toFixed(2),
      installmentId: String(application.installmentId),
      installmentNumber: Number(application.installmentNumber),
      interestComponent: toMoney(application.interestComponent).toFixed(2),
      principalComponent: toMoney(application.principalComponent).toFixed(2),
    })),
    collector: {
      fullName: receipt.collector?.fullName ? String(receipt.collector.fullName) : undefined,
      id: String(receipt.collector?.id ?? receipt.collectorId),
    },
    collectorId: String(receipt.collectorId),
    createdAt: String(receipt.createdAt),
    customer: {
      fullName: String(receipt.customer?.fullName),
      governmentId: receipt.customer?.governmentId ? String(receipt.customer.governmentId) : undefined,
      id: String(receipt.customer?.id),
      phone: receipt.customer?.phone ? String(receipt.customer.phone) : undefined,
    },
    deviceLocalId: String(receipt.deviceLocalId),
    loan: {
      currencyCode: String(receipt.loan?.currencyCode),
      externalLoanNumber: receipt.loan?.externalLoanNumber ? String(receipt.loan.externalLoanNumber) : undefined,
      id: String(receipt.loan?.id),
    },
    paidAt: String(receipt.paidAt),
    paymentId: String(receipt.paymentId),
    paymentMethod: String(receipt.paymentMethod),
    paymentReference: receipt.paymentReference ? String(receipt.paymentReference) : undefined,
    reversal: receipt.reversal
      ? {
          reason: String(receipt.reversal.reason),
          reversedAt: String(receipt.reversal.reversedAt),
          reversedBy: {
            fullName: receipt.reversal.reversedBy?.fullName
              ? String(receipt.reversal.reversedBy.fullName)
              : undefined,
            id: String(receipt.reversal.reversedBy?.id),
          },
        }
      : undefined,
    status: receipt.status === 'reversed' ? 'reversed' : 'posted',
    totalAmount: toMoney(receipt.totalAmount).toFixed(2),
  }
}

function resetPlayground(stage: 'after' | 'before') {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  const result = spawnSync(npmCommand, ['run', 'db:playground:reset'], {
    encoding: 'utf8',
    stdio: 'inherit',
  })

  if (result.status !== 0) {
    throw new Error(`playground_reset_failed:${stage}`)
  }
}
