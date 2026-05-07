import { assertNoSupabaseError, createPublicSupabaseClient } from './lib/supabase-public-client.mjs'

const usage = `Usage:
  node scripts/phase4-auth-user.mjs sign-up <email> <password>
  node scripts/phase4-auth-user.mjs smoke <email> <password> [expected-role]
`

main().catch((error) => {
  if (error instanceof Error && 'code' in error) {
    console.error(
      JSON.stringify(
        {
          code: error.code,
          details: error.details ?? null,
          hint: error.hint ?? null,
          message: error.message,
        },
        null,
        2,
      ),
    )
  } else {
    console.error(error instanceof Error ? error.message : error)
  }
  process.exitCode = 1
})

async function main() {
  const command = process.argv[2]
  const email = process.argv[3]
  const password = process.argv[4]
  const expectedRole = process.argv[5]

  if (!command || !email || !password) {
    throw new Error(usage)
  }

  const supabaseClient = createPublicSupabaseClient()

  if (command === 'sign-up') {
    await signUpCollectorUser(supabaseClient, email, password)
    return
  }

  if (command === 'smoke') {
    await runAuthenticatedSmoke(supabaseClient, email, password, expectedRole)
    return
  }

  throw new Error(usage)
}

async function signUpCollectorUser(supabaseClient, email, password) {
  // Este alta usa el flujo Auth real con publishable key.
  // La parte sensible de rol/app_metadata se completa luego por SQL controlado.
  // En LANDING hoy existe un seed SQL alterno porque signup puede topar rate limit.
  const { data, error } = await supabaseClient.auth.signUp({
    email,
    options: {
      data: {
        full_name: 'Fase 4 Collector',
      },
    },
    password,
  })

  if (error) {
    if (error.message.toLowerCase().includes('already registered')) {
      console.log(JSON.stringify({ email, status: 'already_registered' }, null, 2))
      return
    }

    throw error
  }

  console.log(
    JSON.stringify(
      {
        email,
        sessionPresent: Boolean(data.session),
        status: 'signed_up',
        userId: data.user?.id ?? null,
      },
      null,
      2,
    ),
  )
}

async function runAuthenticatedSmoke(supabaseClient, email, password, expectedRole) {
  // Este smoke valida el mismo patrón que usará la UI:
  // login por password con publishable key y lecturas sujetas a RLS.
  // No reemplaza las compuertas financieras ni de sync, pero sí confirma que el
  // dataset remoto operativo quedó visible y completo bajo el alcance real del cobrador.
  const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  })

  if (authError) {
    throw authError
  }

  const userId = authData.user.id

  const profileResult = await supabaseClient
    .from('profiles')
    .select('id, full_name, role')
    .eq('id', userId)
    .maybeSingle()
  assertNoSupabaseError('profiles', profileResult.error)

  if (expectedRole && profileResult.data?.role !== expectedRole) {
    throw new Error(`unexpected_profile_role:${profileResult.data?.role ?? 'missing'}!=${expectedRole}`)
  }

  const customersResult = await supabaseClient
    .from('customers')
    .select('id, full_name, assigned_collector_id')
    .order('full_name')
  assertNoSupabaseError('customers', customersResult.error)

  const loansResult = await supabaseClient
    .from('loans')
    .select('id, customer_id, collector_id, status')
    .order('created_at')
  assertNoSupabaseError('loans', loansResult.error)

  const installmentsResult = await supabaseClient
    .from('installments')
    .select('id, loan_id, installment_number, due_date, outstanding_amount, scheduled_amount, status')
    .order('due_date')
    .order('installment_number')
  assertNoSupabaseError('installments', installmentsResult.error)

  const customers = customersResult.data ?? []
  const loans = loansResult.data ?? []
  const installments = installmentsResult.data ?? []
  const loanStatusCounts = countBy(loans, 'status')
  const installmentStatusCounts = countBy(installments, 'status')
  const customerNames = customers.map((customer) => customer.full_name).sort()

  assertAtLeast(customers.length, 4, 'expected_phase4_customer_count')
  assertAtLeast(loans.length, 4, 'expected_phase4_loan_count')
  assertAtLeast(installments.length, 9, 'expected_phase4_installment_count')
  assertAtLeast(loanStatusCounts.active ?? 0, 2, 'expected_active_loans')
  assertAtLeast(loanStatusCounts.delinquent ?? 0, 1, 'expected_delinquent_loans')
  assertAtLeast(loanStatusCounts.settled ?? 0, 1, 'expected_settled_loans')
  assertAtLeast(installmentStatusCounts.overdue ?? 0, 2, 'expected_overdue_installments')
  assertAtLeast(installmentStatusCounts.pending ?? 0, 5, 'expected_pending_installments')
  assertAtLeast(installmentStatusCounts.paid ?? 0, 1, 'expected_paid_installments')
  assertIncludes(customerNames, 'Ana Gomez', 'missing_customer_ana_gomez')
  assertIncludes(customerNames, 'Brayan Rojas', 'missing_customer_brayan_rojas')
  assertIncludes(customerNames, 'Carolina Perez', 'missing_customer_carolina_perez')
  assertIncludes(customerNames, 'Diana Torres', 'missing_customer_diana_torres')

  const hasPartialOutstandingInstallment = installments.some((installment) => {
    const outstandingAmount = Number(installment.outstanding_amount)
    const scheduledAmount = Number(installment.scheduled_amount)

    return outstandingAmount > 0 && outstandingAmount < scheduledAmount
  })

  if (!hasPartialOutstandingInstallment) {
    throw new Error('missing_partial_outstanding_installment')
  }

  await supabaseClient.auth.signOut()

  console.log(
    JSON.stringify(
      {
        customerNames,
        customers: customers.length,
        installmentStatusCounts,
      installments: installments.length,
      expectedRole: expectedRole ?? null,
      loanStatusCounts,
      loans: loans.length,
      profile: profileResult.data,
        userId,
      },
      null,
      2,
    ),
  )
}

function countBy(rows, key) {
  return rows.reduce((counts, row) => {
    const value = row[key]

    if (typeof value !== 'string' || !value) {
      return counts
    }

    counts[value] = (counts[value] ?? 0) + 1
    return counts
  }, {})
}

function assertAtLeast(actual, minimum, code) {
  if (actual < minimum) {
    throw new Error(`${code}:${actual}<${minimum}`)
  }
}

function assertIncludes(values, expectedValue, code) {
  if (!values.includes(expectedValue)) {
    throw new Error(`${code}:${expectedValue}`)
  }
}
