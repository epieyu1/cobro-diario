import { randomUUID } from 'node:crypto'
import {
  buildOldestFirstPaymentApplications,
  deriveOutstandingInstallmentComponents,
  sumMoney,
} from './lib/financial-v1.mjs'
import {
  buildOriginationSchedule,
  formatBogotaBusinessDate,
  serializeOriginationScheduleForRpc,
} from './lib/origination-v1.mjs'
import { assertNoSupabaseError, createPublicSupabaseClient } from './lib/supabase-public-client.mjs'

const usage = `Usage:
  node scripts/phase7-origination-smoke.mjs <admin-email> <admin-password> <collector-email> <collector-password>
`

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})

async function main() {
  const adminEmail = process.argv[2]
  const adminPassword = process.argv[3]
  const collectorEmail = process.argv[4]
  const collectorPassword = process.argv[5]

  if (!adminEmail || !adminPassword || !collectorEmail || !collectorPassword) {
    throw new Error(usage)
  }

  const collectorProfile = await withUserSession(collectorEmail, collectorPassword, async (supabaseClient, session) => {
    const profile = await loadProfile(supabaseClient, session.userId)

    if (profile.role !== 'collector' || profile.active !== true) {
      throw new Error('collector_profile_invalid_for_smoke')
    }

    return profile
  })

  const smokeId = `${Date.now()}-${randomUUID().slice(0, 8)}`
  const schedule = buildOriginationSchedule({
    disbursementDate: formatBogotaBusinessDate(),
    firstDueDate: formatBogotaBusinessDate(),
    installmentAmount: '70.00',
    paymentFrequency: 'daily',
    principalAmount: '120.00',
    totalInstallments: 2,
  })
  const customerName = `OR4 Smoke ${smokeId}`
  const governmentId = `OR4-${smokeId}`
  const phone = `31${String(Date.now()).slice(-8)}`

  let origination = null
  let collectorResult = null
  let cleanupResult = null

  try {
    origination = await withUserSession(adminEmail, adminPassword, async (supabaseClient, session) => {
      const profile = await loadProfile(supabaseClient, session.userId)

      if (profile.role !== 'admin' || profile.active !== true) {
        throw new Error('admin_profile_invalid_for_smoke')
      }

      const result = await supabaseClient.rpc('originate_loan', {
        p_customer_payload: {
          address_line: 'Calle OR4 # 10-20',
          assigned_collector_id: collectorProfile.id,
          full_name: customerName,
          government_id: governmentId,
          neighborhood: 'Smoke OR4',
          notes: `Smoke OR-4 ${smokeId}`,
          phone,
        },
        p_existing_customer_id: null,
        p_installments: serializeOriginationScheduleForRpc(schedule),
        p_loan_payload: {
          collector_id: collectorProfile.id,
          currency_code: 'COP',
          disbursement_date: schedule.disbursementDate,
          first_due_date: schedule.firstDueDate,
          installment_amount: schedule.installmentAmount,
          interest_mode: 'simple_precomputed',
          interest_rate_daily: '0.050000',
          notes: `Smoke OR-4 ${smokeId}`,
          payment_frequency: schedule.paymentFrequency,
          principal_amount: schedule.totalPrincipalAmount,
          total_installments: schedule.totalInstallments,
        },
      })
      assertNoSupabaseError('originate_loan', result.error)

      if (
        !result.data ||
        typeof result.data.loan_id !== 'string' ||
        typeof result.data.customer_id !== 'string' ||
        typeof result.data.external_loan_number !== 'string'
      ) {
        throw new Error('invalid_origination_smoke_response')
      }

      return {
        createdCustomer: Boolean(result.data.created_customer),
        customerId: result.data.customer_id,
        externalLoanNumber: result.data.external_loan_number,
        loanId: result.data.loan_id,
      }
    })

    collectorResult = await withUserSession(
      collectorEmail,
      collectorPassword,
      async (supabaseClient, session) => {
        const customerResult = await supabaseClient
          .from('customers')
          .select('id, full_name, government_id, assigned_collector_id')
          .eq('government_id', governmentId)
          .maybeSingle()
        assertNoSupabaseError('customers.single', customerResult.error)

        if (!customerResult.data || customerResult.data.assigned_collector_id !== session.userId) {
          throw new Error('originated_customer_not_visible_to_collector')
        }

        const loanContext = await loadLoanContext(supabaseClient, origination.externalLoanNumber)
        const normalizedInstallments = normalizeInstallmentRows(loanContext.installments)
        const firstInstallment = normalizedInstallments[0]

        if (!firstInstallment) {
          throw new Error('originated_installments_missing')
        }

        const applications = buildOldestFirstPaymentApplications(firstInstallment.outstandingAmount, normalizedInstallments)
        const paymentReference = `OR4-${origination.externalLoanNumber}-${Date.now()}`
        const deviceLocalId = `or4:${origination.externalLoanNumber}:${Date.now()}:${randomUUID()}`
        const deviceId = await loadFirstCollectorDeviceId(supabaseClient)
        const paymentResult = await supabaseClient.rpc('record_payment', {
          p_applications: applications.map((application) => ({
            applied_amount: application.appliedAmount,
            fee_component: application.feeComponent,
            installment_id: application.installmentId,
            interest_component: application.interestComponent,
            principal_component: application.principalComponent,
          })),
          p_collector_id: session.userId,
          p_customer_id: loanContext.loan.customer_id,
          p_device_id: deviceId,
          p_device_local_id: deviceLocalId,
          p_latitude: null,
          p_loan_id: loanContext.loan.id,
          p_longitude: null,
          p_notes: `Smoke OR-4 ${smokeId}`,
          p_paid_at: new Date().toISOString(),
          p_payment_method: 'cash',
          p_payment_reference: paymentReference,
        })
        assertNoSupabaseError('record_payment', paymentResult.error)

        if (typeof paymentResult.data !== 'string' || !paymentResult.data) {
          throw new Error('invalid_smoke_payment_id')
        }

        const afterPaymentContext = await loadLoanContext(supabaseClient, origination.externalLoanNumber)
        const paidInstallment = afterPaymentContext.installments.find(
          (installment) => installment.id === firstInstallment.id,
        )

        if (!paidInstallment) {
          throw new Error('paid_installment_not_found_after_payment')
        }

        if (Number(paidInstallment.outstanding_amount) !== 0 || paidInstallment.status !== 'paid') {
          throw new Error('first_installment_not_paid_after_smoke')
        }

        return {
          applications,
          customerId: customerResult.data.id,
          customerName: customerResult.data.full_name,
          firstInstallmentId: firstInstallment.id,
          paymentId: paymentResult.data,
          paymentReference,
          visibleInstallmentCount: loanContext.installments.length,
        }
      },
    )
  } finally {
    cleanupResult = origination
      ? await settleResidualSmokeBalance({
          collectorEmail,
          collectorPassword,
          externalLoanNumber: origination.externalLoanNumber,
          smokeId,
          smokeScope: 'OR4',
        })
      : {
          settledLoan: false,
          skipped: true,
        }
  }

  console.log(
    JSON.stringify(
      {
        cleanup: cleanupResult,
        collectorProfile: {
          fullName: collectorProfile.full_name,
          id: collectorProfile.id,
        },
        customerName,
        externalLoanNumber: origination.externalLoanNumber,
        firstInstallmentPaid: true,
        governmentId,
        loanId: origination.loanId,
        paymentId: collectorResult.paymentId,
        result: 'ok',
        visibility: {
          customerId: collectorResult.customerId,
          visibleInstallmentCount: collectorResult.visibleInstallmentCount,
        },
      },
      null,
      2,
    ),
  )
}

async function withUserSession(email, password, callback) {
  const supabaseClient = createPublicSupabaseClient()
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  })
  assertNoSupabaseError('auth.signInWithPassword', error)

  try {
    const userId = data.user?.id

    if (!userId) {
      throw new Error('missing_authenticated_user')
    }

    return await callback(supabaseClient, { userId })
  } finally {
    await supabaseClient.auth.signOut()
  }
}

async function loadProfile(supabaseClient, userId) {
  const result = await supabaseClient
    .from('profiles')
    .select('id, full_name, role, active')
    .eq('id', userId)
    .maybeSingle()
  assertNoSupabaseError('profiles.single', result.error)

  if (!result.data) {
    throw new Error('profile_not_found')
  }

  return result.data
}

async function loadLoanContext(supabaseClient, externalLoanNumber) {
  const loanResult = await supabaseClient
    .from('loans')
    .select('id, customer_id, collector_id, external_loan_number, status')
    .eq('external_loan_number', externalLoanNumber)
    .maybeSingle()
  assertNoSupabaseError('loans.single', loanResult.error)

  if (!loanResult.data) {
    throw new Error(`loan_not_found:${externalLoanNumber}`)
  }

  const installmentsResult = await supabaseClient
    .from('installments')
    .select(
      'id, loan_id, installment_number, due_date, scheduled_amount, principal_amount, interest_amount, fee_amount, outstanding_amount, status',
    )
    .eq('loan_id', loanResult.data.id)
    .order('due_date')
    .order('installment_number')
  assertNoSupabaseError('installments.single-loan', installmentsResult.error)

  return {
    installments: installmentsResult.data ?? [],
    loan: loanResult.data,
  }
}

async function loadFirstCollectorDeviceId(supabaseClient) {
  const result = await supabaseClient
    .from('devices')
    .select('id')
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  assertNoSupabaseError('devices.first', result.error)

  return result.data?.id ?? null
}

function normalizeInstallmentRows(installments) {
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
    }
  })
}

async function settleResidualSmokeBalance({
  collectorEmail,
  collectorPassword,
  externalLoanNumber,
  smokeId,
  smokeScope,
}) {
  // Intencion: cada smoke que origina un prestamo real en LANDING debe dejar saldo final en cero.
  // Riesgo: si este cleanup se rompe, el dashboard vuelve a mezclar deuda operativa con residuos de prueba.
  // Fuente de verdad: el cierre debe pasar por `record_payment()`; nunca por mutaciones directas desde cliente.
  return withUserSession(collectorEmail, collectorPassword, async (supabaseClient, session) => {
    const beforeCleanupContext = await loadLoanContext(supabaseClient, externalLoanNumber)
    const normalizedInstallments = normalizeInstallmentRows(beforeCleanupContext.installments)
    const totalOutstanding = sumMoney(normalizedInstallments.map((installment) => installment.outstandingAmount))

    if (totalOutstanding.lte(0)) {
      return {
        remainingOutstanding: totalOutstanding.toFixed(2),
        settledLoan: beforeCleanupContext.loan.status === 'settled',
        skipped: true,
      }
    }

    const applications = buildOldestFirstPaymentApplications(totalOutstanding.toFixed(2), normalizedInstallments)
    const paymentReference = `${smokeScope}-cleanup-${externalLoanNumber}-${Date.now()}`
    const deviceLocalId = `${smokeScope.toLowerCase()}:cleanup:${externalLoanNumber}:${Date.now()}:${randomUUID()}`
    const deviceId = await loadFirstCollectorDeviceId(supabaseClient)
    const paymentResult = await supabaseClient.rpc('record_payment', {
      p_applications: applications.map((application) => ({
        applied_amount: application.appliedAmount,
        fee_component: application.feeComponent,
        installment_id: application.installmentId,
        interest_component: application.interestComponent,
        principal_component: application.principalComponent,
      })),
      p_collector_id: session.userId,
      p_customer_id: beforeCleanupContext.loan.customer_id,
      p_device_id: deviceId,
      p_device_local_id: deviceLocalId,
      p_latitude: null,
      p_loan_id: beforeCleanupContext.loan.id,
      p_longitude: null,
      p_notes: `Smoke cleanup ${smokeScope} ${smokeId}`,
      p_paid_at: new Date().toISOString(),
      p_payment_method: 'cash',
      p_payment_reference: paymentReference,
    })
    assertNoSupabaseError('record_payment.cleanup', paymentResult.error)

    const afterCleanupContext = await loadLoanContext(supabaseClient, externalLoanNumber)
    const remainingOutstanding = sumMoney(
      afterCleanupContext.installments.map((installment) => installment.outstanding_amount),
    )

    if (remainingOutstanding.gt(0) || afterCleanupContext.loan.status !== 'settled') {
      throw new Error(`smoke_cleanup_incomplete:${externalLoanNumber}`)
    }

    return {
      paymentId: paymentResult.data,
      remainingOutstanding: remainingOutstanding.toFixed(2),
      settledLoan: true,
      skipped: false,
    }
  })
}
