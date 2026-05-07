import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  OriginationCollectorOption,
  OriginationExistingCustomerOption,
  ValidatedOriginationSubmission,
} from '@/lib/origination/origination-validation.ts'

type OriginationRpcResponse = {
  created_customer: boolean
  customer_id: string
  external_loan_number: string
  loan_id: string
}

type CollectorProvisionRpcResponse = {
  full_name: string
  id: string
}

export type OriginationTransport = {
  createCollectorAccount(input: {
    email: string
    fullName: string
    password: string
    phone?: string
  }): Promise<{
    id: string
    fullName: string
  }>
  listActiveCollectors(): Promise<OriginationCollectorOption[]>
  originateLoan(submission: ValidatedOriginationSubmission): Promise<{
    createdCustomer: boolean
    customerId: string
    externalLoanNumber: string
    loanId: string
  }>
  searchExistingCustomers(query: string): Promise<OriginationExistingCustomerOption[]>
}

export function createSupabaseOriginationTransport(
  supabaseClient: SupabaseClient,
): OriginationTransport {
  return {
    async createCollectorAccount(input) {
      const normalizedEmail = input.email.trim().toLowerCase()
      const normalizedFullName = input.fullName.trim()
      const normalizedPassword = input.password
      const normalizedPhone = input.phone?.trim() || null

      if (!normalizedFullName) {
        throw new Error('collector_full_name_required')
      }

      if (!normalizedEmail) {
        throw new Error('collector_email_required')
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
        throw new Error('collector_email_invalid')
      }

      if (normalizedPassword.length < 6) {
        throw new Error('collector_password_too_short')
      }

      // Este RPC centraliza el alta Auth + profile dentro de PostgreSQL.
      // Riesgo: volver a repartir este flujo entre browser Auth y REST sobre profiles
      // reabre el 403 del hardening y duplica clientes GoTrue en la misma sesion.
      const { data, error } = await supabaseClient.rpc('provision_collector_account', {
        p_email: normalizedEmail,
        p_full_name: normalizedFullName,
        p_password: normalizedPassword,
        p_phone: normalizedPhone,
      })

      if (error) {
        throw new Error(error.message)
      }

      const normalizedData = data as CollectorProvisionRpcResponse | null

      if (
        !normalizedData ||
        typeof normalizedData.id !== 'string' ||
        typeof normalizedData.full_name !== 'string'
      ) {
        throw new Error('invalid_collector_provision_response')
      }

      return {
        fullName: normalizedData.full_name,
        id: normalizedData.id,
      }
    },

    async listActiveCollectors() {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, phone')
        .eq('role', 'collector')
        .eq('active', true)
        .order('full_name', { ascending: true })

      if (error) {
        throw new Error(error.message)
      }

      return (data ?? []).map((collector) => ({
        fullName: collector.full_name,
        id: collector.id,
        phone: collector.phone ?? undefined,
      }))
    },

    async originateLoan(submission) {
      const { data, error } = await supabaseClient.rpc('originate_loan', {
        p_customer_payload: submission.customerPayload,
        p_existing_customer_id: submission.existingCustomerId,
        p_installments: submission.installmentsPayload,
        p_loan_payload: submission.loanPayload,
      })

      if (error) {
        throw new Error(error.message)
      }

      const normalizedData = data as OriginationRpcResponse | null

      if (
        !normalizedData ||
        typeof normalizedData.customer_id !== 'string' ||
        typeof normalizedData.loan_id !== 'string' ||
        typeof normalizedData.external_loan_number !== 'string'
      ) {
        throw new Error('invalid_origination_response')
      }

      return {
        createdCustomer: Boolean(normalizedData.created_customer),
        customerId: normalizedData.customer_id,
        externalLoanNumber: normalizedData.external_loan_number,
        loanId: normalizedData.loan_id,
      }
    },

    async searchExistingCustomers(query) {
      const normalizedQuery = query.trim()

      if (normalizedQuery.length < 2) {
        return []
      }

      const escapedQuery = normalizedQuery.replaceAll(',', ' ')
      const { data, error } = await supabaseClient
        .from('customers')
        .select('id, assigned_collector_id, full_name, government_id, phone, address_line, route_label, neighborhood')
        .is('archived_at', null)
        .or(
          [
            `government_id.ilike.%${escapedQuery}%`,
            `full_name.ilike.%${escapedQuery}%`,
            `phone.ilike.%${escapedQuery}%`,
          ].join(','),
        )
        .order('full_name', { ascending: true })
        .limit(10)

      if (error) {
        throw new Error(error.message)
      }

      return (data ?? []).map((customer) => ({
        addressLine: customer.address_line ?? undefined,
        assignedCollectorId: customer.assigned_collector_id,
        fullName: customer.full_name,
        governmentId: customer.government_id ?? undefined,
        id: customer.id,
        neighborhood: customer.neighborhood?.trim() || undefined,
        phone: customer.phone ?? undefined,
        routeLabel: customer.route_label?.trim() || undefined,
      }))
    },
  }
}
