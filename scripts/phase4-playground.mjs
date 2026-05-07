import { randomUUID } from 'node:crypto'
import { assertNoSupabaseError, createPublicSupabaseClient } from './lib/supabase-public-client.mjs'
import {
  buildOldestFirstPaymentApplications,
  deriveOutstandingInstallmentComponents,
  isCollectibleInstallment,
  sumMoney,
  toMoney,
} from './lib/financial-v1.mjs'

const usage = `Usage:
  node scripts/phase4-playground.mjs status <email> <password> [external-loan-number]
  node scripts/phase4-playground.mjs pay <email> <password> <external-loan-number> <amount> [note]
  node scripts/phase4-playground.mjs settle <email> <password> <external-loan-number> [note]
`

main().catch((error) => {
  if (error instanceof Error) {
    console.error(error.message)
  } else {
    console.error(error)
  }
  process.exitCode = 1
})

async function main() {
  const command = process.argv[2]
  const email = process.argv[3]
  const password = process.argv[4]

  if (!command || !email || !password) {
    throw new Error(usage)
  }

  const supabaseClient = createPublicSupabaseClient()

  if (command === 'status') {
    await withCollectorSession(supabaseClient, email, password, async (session) => {
      const externalLoanNumber = process.argv[5]
      const snapshot = await loadPlaygroundStatus(supabaseClient, session.userId, externalLoanNumber)

      console.log(JSON.stringify(snapshot, null, 2))
    })
    return
  }

  if (command === 'pay') {
    const externalLoanNumber = process.argv[5]
    const requestedAmount = process.argv[6]
    const note = process.argv.slice(7).join(' ').trim()

    if (!externalLoanNumber || !requestedAmount) {
      throw new Error(usage)
    }

    await withCollectorSession(supabaseClient, email, password, async (session) => {
      const result = await recordPlaygroundPayment(supabaseClient, session, {
        command,
        externalLoanNumber,
        note,
        requestedAmount,
      })

      console.log(JSON.stringify(result, null, 2))
    })
    return
  }

  if (command === 'settle') {
    const externalLoanNumber = process.argv[5]
    const note = process.argv.slice(6).join(' ').trim()

    if (!externalLoanNumber) {
      throw new Error(usage)
    }

    await withCollectorSession(supabaseClient, email, password, async (session) => {
      const loanContext = await loadLoanContext(supabaseClient, externalLoanNumber)
      const requestedAmount = summarizeLoanOutstanding(loanContext.installments)

      if (toMoney(requestedAmount).lte(0)) {
        throw new Error('loan_already_settled')
      }

      const result = await recordPlaygroundPayment(supabaseClient, session, {
        command,
        externalLoanNumber,
        note,
        requestedAmount,
      })

      console.log(JSON.stringify(result, null, 2))
    })
    return
  }

  throw new Error(usage)
}

async function withCollectorSession(supabaseClient, email, password, callback) {
  // Este login usa el mismo canal publishable + password + RLS que usa la app.
  // Si falla aqui, la evidencia invalida tanto el playground como el flujo real del cobrador.
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

    return await callback({ userId })
  } finally {
    await supabaseClient.auth.signOut()
  }
}

async function loadPlaygroundStatus(supabaseClient, userId, externalLoanNumber) {
  if (externalLoanNumber) {
    return loadSingleLoanStatus(supabaseClient, userId, externalLoanNumber)
  }

  const [profileResult, devicesResult, customersResult, loansResult, installmentsResult, paymentsResult] =
    await Promise.all([
      supabaseClient.from('profiles').select('id, full_name, role, active').eq('id', userId).maybeSingle(),
      supabaseClient
        .from('devices')
        .select('id, device_name, device_uid, collector_id, last_seen_at')
        .order('last_seen_at', { ascending: false }),
      supabaseClient
        .from('customers')
        .select('id, full_name, government_id, phone, neighborhood, address_line, notes')
        .order('full_name'),
      supabaseClient
        .from('loans')
        .select(
          'id, customer_id, collector_id, external_loan_number, principal_amount, installment_amount, total_installments, currency_code, disbursement_date, first_due_date, status, notes, created_at',
        )
        .order('created_at'),
      supabaseClient
        .from('installments')
        .select(
          'id, loan_id, installment_number, due_date, scheduled_amount, principal_amount, interest_amount, fee_amount, outstanding_amount, status',
        )
        .order('due_date')
        .order('installment_number'),
      supabaseClient
        .from('payments')
        .select('id, loan_id, total_amount, payment_method, payment_reference, device_local_id, status, notes, paid_at')
        .order('paid_at', { ascending: false }),
    ])

  assertNoSupabaseError('profiles', profileResult.error)
  assertNoSupabaseError('devices', devicesResult.error)
  assertNoSupabaseError('customers', customersResult.error)
  assertNoSupabaseError('loans', loansResult.error)
  assertNoSupabaseError('installments', installmentsResult.error)
  assertNoSupabaseError('payments', paymentsResult.error)

  const payments = paymentsResult.data ?? []
  const paymentIds = payments.map((payment) => payment.id)
  const paymentApplicationsByPaymentId = await loadPaymentApplicationsByPaymentId(supabaseClient, paymentIds)
  const customersById = new Map((customersResult.data ?? []).map((customer) => [customer.id, customer]))
  const installmentsByLoanId = groupBy(installmentsResult.data ?? [], 'loan_id')
  const paymentsByLoanId = groupBy(payments, 'loan_id')
  const loans = (loansResult.data ?? []).map((loan) =>
    serializeLoanSnapshot(
      loan,
      customersById.get(loan.customer_id),
      installmentsByLoanId.get(loan.id) ?? [],
      paymentsByLoanId.get(loan.id) ?? [],
      paymentApplicationsByPaymentId,
    ),
  )

  return {
    devices: devicesResult.data ?? [],
    loans,
    profile: profileResult.data,
    summary: {
      activeLoanCount: loans.filter((loan) => loan.status === 'active').length,
      customerCount: customersById.size,
      delinquentLoanCount: loans.filter((loan) => loan.status === 'delinquent').length,
      loanCount: loans.length,
      settledLoanCount: loans.filter((loan) => loan.status === 'settled').length,
      totalOutstandingAmount: sumMoney(loans.map((loan) => loan.outstandingAmount)).toFixed(2),
    },
  }
}

async function loadSingleLoanStatus(supabaseClient, userId, externalLoanNumber) {
  const profileResult = await supabaseClient
    .from('profiles')
    .select('id, full_name, role, active')
    .eq('id', userId)
    .maybeSingle()
  assertNoSupabaseError('profiles', profileResult.error)

  const loanContext = await loadLoanContext(supabaseClient, externalLoanNumber)

  return {
    loan: serializeLoanSnapshot(
      loanContext.loan,
      loanContext.customer,
      loanContext.installments,
      loanContext.payments,
      loanContext.paymentApplicationsByPaymentId,
    ),
    profile: profileResult.data,
  }
}

async function recordPlaygroundPayment(supabaseClient, session, options) {
  // Flujo: Data API -> reconstruccion oldest-first en Node -> RPC record_payment -> relectura remota.
  // La verdad final del pago sigue viviendo en PostgreSQL; este script solo automatiza una prueba real editable.
  const loanContext = await loadLoanContext(supabaseClient, options.externalLoanNumber)
  const deviceId = await loadFirstDeviceId(supabaseClient)
  const installments = normalizeInstallmentRows(loanContext.installments)
  const applications = buildOldestFirstPaymentApplications(options.requestedAmount, installments)
  const deviceLocalId = `playground:${options.externalLoanNumber}:${Date.now()}:${randomUUID()}`
  const paymentReference = `PLAYGROUND-${options.externalLoanNumber}-${Date.now()}`
  const paidAt = new Date().toISOString()
  const beforeLoan = serializeLoanSnapshot(
    loanContext.loan,
    loanContext.customer,
    loanContext.installments,
    loanContext.payments,
    loanContext.paymentApplicationsByPaymentId,
  )

  const payload = {
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
    p_notes: options.note || `PLAYGROUND ${options.externalLoanNumber}`,
    p_paid_at: paidAt,
    p_payment_method: 'cash',
    p_payment_reference: paymentReference,
  }

  const paymentResult = await supabaseClient.rpc('record_payment', payload)
  assertNoSupabaseError('record_payment', paymentResult.error)

  if (typeof paymentResult.data !== 'string' || !paymentResult.data) {
    throw new Error('invalid_payment_id')
  }

  const afterContext = await loadLoanContext(supabaseClient, options.externalLoanNumber)

  return {
    after: serializeLoanSnapshot(
      afterContext.loan,
      afterContext.customer,
      afterContext.installments,
      afterContext.payments,
      afterContext.paymentApplicationsByPaymentId,
    ),
    applications,
    before: beforeLoan,
    command: options.command,
    deviceId,
    deviceLocalId,
    externalLoanNumber: options.externalLoanNumber,
    paidAt,
    paymentId: paymentResult.data,
    paymentReference,
    requestedAmount: toMoney(options.requestedAmount).toFixed(2),
  }
}

async function loadLoanContext(supabaseClient, externalLoanNumber) {
  const loanResult = await supabaseClient
    .from('loans')
    .select(
      'id, customer_id, collector_id, external_loan_number, principal_amount, installment_amount, total_installments, currency_code, disbursement_date, first_due_date, status, notes, created_at',
    )
    .eq('external_loan_number', externalLoanNumber)
    .maybeSingle()
  assertNoSupabaseError('loans.single', loanResult.error)

  if (!loanResult.data) {
    throw new Error(`loan_not_found:${externalLoanNumber}`)
  }

  const [customerResult, installmentsResult, paymentsResult] = await Promise.all([
    supabaseClient
      .from('customers')
      .select('id, full_name, government_id, phone, neighborhood, address_line, notes')
      .eq('id', loanResult.data.customer_id)
      .maybeSingle(),
    supabaseClient
      .from('installments')
      .select(
        'id, loan_id, installment_number, due_date, scheduled_amount, principal_amount, interest_amount, fee_amount, outstanding_amount, status',
      )
      .eq('loan_id', loanResult.data.id)
      .order('due_date')
      .order('installment_number'),
    supabaseClient
      .from('payments')
      .select('id, loan_id, total_amount, payment_method, payment_reference, device_local_id, status, notes, paid_at')
      .eq('loan_id', loanResult.data.id)
      .order('paid_at', { ascending: false }),
  ])

  assertNoSupabaseError('customers.single', customerResult.error)
  assertNoSupabaseError('installments.single-loan', installmentsResult.error)
  assertNoSupabaseError('payments.single-loan', paymentsResult.error)

  const payments = paymentsResult.data ?? []
  const paymentApplicationsByPaymentId = await loadPaymentApplicationsByPaymentId(
    supabaseClient,
    payments.map((payment) => payment.id),
  )

  return {
    customer: customerResult.data,
    installments: installmentsResult.data ?? [],
    loan: loanResult.data,
    paymentApplicationsByPaymentId,
    payments,
  }
}

async function loadFirstDeviceId(supabaseClient) {
  const deviceResult = await supabaseClient
    .from('devices')
    .select('id')
    .order('last_seen_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  assertNoSupabaseError('devices.first', deviceResult.error)

  return deviceResult.data?.id ?? null
}

async function loadPaymentApplicationsByPaymentId(supabaseClient, paymentIds) {
  if (paymentIds.length === 0) {
    return new Map()
  }

  const applicationsResult = await supabaseClient
    .from('payment_applications')
    .select(
      'payment_id, installment_id, applied_amount, principal_component, interest_component, fee_component',
    )
    .in('payment_id', paymentIds)
  assertNoSupabaseError('payment_applications', applicationsResult.error)

  return groupBy(applicationsResult.data ?? [], 'payment_id')
}

function serializeLoanSnapshot(loan, customer, installmentRows, paymentRows, paymentApplicationsByPaymentId) {
  // Esta salida materializa el estado remoto legible para pruebas de negocio.
  // No deriva estados alternos fuera del contrato V1; expone lo que ya confirma la base.
  const installments = normalizeInstallmentRows(installmentRows).map((installment) => {
    const outstandingBreakdown = deriveOutstandingInstallmentComponents(installment)

    return {
      dueDate: installment.dueDate,
      installmentNumber: installment.installmentNumber,
      outstandingAmount: toMoney(installment.outstandingAmount).toFixed(2),
      outstandingBreakdown,
      scheduledAmount: toMoney(installment.scheduledAmount).toFixed(2),
      status: installment.status,
    }
  })
  const collectibleInstallments = normalizeInstallmentRows(installmentRows).filter(isCollectibleInstallment)
  const outstandingAmount = summarizeLoanOutstanding(installmentRows)
  const nextCollectibleInstallment = collectibleInstallments[0] ?? null
  const recentPayments = paymentRows.slice(0, 5).map((payment) => ({
    applications: (paymentApplicationsByPaymentId.get(payment.id) ?? []).map((application) => ({
      appliedAmount: toMoney(application.applied_amount).toFixed(2),
      feeComponent: toMoney(application.fee_component).toFixed(2),
      installmentId: application.installment_id,
      interestComponent: toMoney(application.interest_component).toFixed(2),
      principalComponent: toMoney(application.principal_component).toFixed(2),
    })),
    deviceLocalId: payment.device_local_id,
    notes: payment.notes,
    paidAt: payment.paid_at,
    paymentId: payment.id,
    paymentMethod: payment.payment_method,
    paymentReference: payment.payment_reference,
    status: payment.status,
    totalAmount: toMoney(payment.total_amount).toFixed(2),
  }))

  return {
    currencyCode: loan.currency_code,
    customer: customer
      ? {
          addressLine: customer.address_line,
          fullName: customer.full_name,
          governmentId: customer.government_id,
          neighborhood: customer.neighborhood,
          notes: customer.notes,
          phone: customer.phone,
        }
      : null,
    disbursementDate: loan.disbursement_date,
    externalLoanNumber: loan.external_loan_number,
    firstDueDate: loan.first_due_date,
    installments,
    nextCollectibleInstallment: nextCollectibleInstallment
      ? {
          dueDate: nextCollectibleInstallment.dueDate,
          installmentNumber: nextCollectibleInstallment.installmentNumber,
          outstandingAmount: toMoney(nextCollectibleInstallment.outstandingAmount).toFixed(2),
        }
      : null,
    notes: loan.notes,
    outstandingAmount,
    principalAmount: toMoney(loan.principal_amount).toFixed(2),
    recentPayments,
    scheduledInstallmentAmount: toMoney(loan.installment_amount).toFixed(2),
    status: loan.status,
    totalInstallments: loan.total_installments,
  }
}

function summarizeLoanOutstanding(installmentRows) {
  return sumMoney(installmentRows.map((installment) => installment.outstanding_amount ?? installment.outstandingAmount)).toFixed(2)
}

function normalizeInstallmentRows(installmentRows) {
  return installmentRows.map((installment) => ({
    dueDate: installment.due_date ?? installment.dueDate,
    feeAmount: installment.fee_amount ?? installment.feeAmount,
    id: installment.id,
    installmentNumber: installment.installment_number ?? installment.installmentNumber,
    interestAmount: installment.interest_amount ?? installment.interestAmount,
    outstandingAmount: installment.outstanding_amount ?? installment.outstandingAmount,
    principalAmount: installment.principal_amount ?? installment.principalAmount,
    scheduledAmount: installment.scheduled_amount ?? installment.scheduledAmount,
    status: installment.status,
  }))
}

function groupBy(rows, key) {
  const groupedRows = new Map()

  for (const row of rows) {
    const groupKey = row[key]

    if (!groupedRows.has(groupKey)) {
      groupedRows.set(groupKey, [])
    }

    groupedRows.get(groupKey).push(row)
  }

  return groupedRows
}
