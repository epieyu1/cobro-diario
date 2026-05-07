-- Enriquecer el recibo confirmado sin reabrir lecturas privilegiadas.
-- Flujo: get_payment_receipt() sigue leyendo el pago ya confirmado bajo RLS, pero ahora
-- expone el nombre del cobrador dentro del mismo contrato para que UI/PDF no adivinen
-- la identidad desde cache local ni desde la sesion actual.
-- Riesgo: si el recibo toma el nombre del operador desde la shell local, una sesion admin
-- podria mostrar al administrador actual como cobrador de un pago que realmente pertenece
-- a otra cartera.

create or replace function public.get_payment_receipt(p_payment_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_applications jsonb;
  v_payment record;
begin
  if auth.uid() is null then
    raise exception 'authentication_required';
  end if;

  if not private.current_profile_is_active() then
    raise exception 'operator_inactive';
  end if;

  if p_payment_id is null then
    raise exception 'payment_id_required';
  end if;

  select
    public.payments.id as payment_id,
    public.payments.device_local_id,
    public.payments.payment_reference,
    public.payments.payment_method,
    public.payments.status,
    public.payments.total_amount::text as total_amount,
    public.payments.paid_at,
    public.payments.created_at,
    public.payments.collector_id,
    collector_profile.full_name as collector_full_name,
    public.payments.reversed_at,
    public.payments.reversed_by,
    public.payments.reversal_reason,
    reversal_profile.full_name as reversed_by_full_name,
    public.customers.id as customer_id,
    public.customers.full_name as customer_full_name,
    public.customers.government_id as customer_government_id,
    public.customers.phone as customer_phone,
    public.loans.id as loan_id,
    public.loans.external_loan_number,
    public.loans.currency_code
  into v_payment
  from public.payments
  inner join public.customers
    on public.customers.id = public.payments.customer_id
  inner join public.loans
    on public.loans.id = public.payments.loan_id
  inner join public.profiles as collector_profile
    on collector_profile.id = public.payments.collector_id
  left join public.profiles as reversal_profile
    on reversal_profile.id = public.payments.reversed_by
  where public.payments.id = p_payment_id;

  if not found then
    raise exception 'payment_not_found';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'installmentId', public.installments.id,
        'installmentNumber', public.installments.installment_number,
        'dueDate', public.installments.due_date,
        'appliedAmount', public.payment_applications.applied_amount::text,
        'principalComponent', public.payment_applications.principal_component::text,
        'interestComponent', public.payment_applications.interest_component::text,
        'feeComponent', public.payment_applications.fee_component::text
      )
      order by public.installments.installment_number asc
    ),
    '[]'::jsonb
  )
  into v_applications
  from public.payment_applications
  inner join public.installments
    on public.installments.id = public.payment_applications.installment_id
  where public.payment_applications.payment_id = p_payment_id;

  return jsonb_build_object(
    'paymentId', v_payment.payment_id,
    'deviceLocalId', v_payment.device_local_id,
    'paymentReference', v_payment.payment_reference,
    'paymentMethod', v_payment.payment_method,
    'status', v_payment.status,
    'totalAmount', v_payment.total_amount,
    'paidAt', v_payment.paid_at,
    'createdAt', v_payment.created_at,
    'collectorId', v_payment.collector_id,
    'collector', jsonb_build_object(
      'id', v_payment.collector_id,
      'fullName', v_payment.collector_full_name
    ),
    'reversal', case
      when v_payment.status = 'reversed'::public.payment_status then jsonb_build_object(
        'reason', v_payment.reversal_reason,
        'reversedAt', v_payment.reversed_at,
        'reversedBy', jsonb_build_object(
          'id', v_payment.reversed_by,
          'fullName', v_payment.reversed_by_full_name
        )
      )
      else null
    end,
    'customer', jsonb_build_object(
      'id', v_payment.customer_id,
      'fullName', v_payment.customer_full_name,
      'governmentId', v_payment.customer_government_id,
      'phone', v_payment.customer_phone
    ),
    'loan', jsonb_build_object(
      'id', v_payment.loan_id,
      'externalLoanNumber', v_payment.external_loan_number,
      'currencyCode', v_payment.currency_code
    ),
    'applications', v_applications
  );
end;
$$;

comment on function public.get_payment_receipt(uuid) is
'Recibo confirmado enriquecido. Mantiene el comprobante autoritativo bajo RLS e incluye identidad del cobrador para que UI/PDF no reconstruyan esa firma desde cache local ni desde la sesion actual.';
