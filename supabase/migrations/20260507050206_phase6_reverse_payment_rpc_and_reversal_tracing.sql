-- BR-5 agrega reverso transaccional trazable sin debilitar RLS ni abrir DML directo.
-- El flujo queda online-only para admin: PostgreSQL sigue siendo la fuente de verdad y
-- la restauracion de saldos ocurre en la misma transaccion del RPC.

alter table public.payments
  add column if not exists reversed_at timestamptz,
  add column if not exists reversed_by uuid references public.profiles (id),
  add column if not exists reversal_reason text;

comment on column public.payments.reversed_at is
'Marca temporal UTC del reverso confirmado. Permanece null mientras el pago siga posted.';

comment on column public.payments.reversed_by is
'Perfil autenticado que reverso el pago. El flujo actual de BR-5 restringe este actor a admin activo.';

comment on column public.payments.reversal_reason is
'Motivo operativo obligatorio del reverso. No usarlo como nota libre silenciosa: queda trazado junto al evento compensatorio.';

alter table public.payments
  drop constraint if exists payments_reversal_metadata_consistency;

alter table public.payments
  add constraint payments_reversal_metadata_consistency
  check (
    (
      status = 'posted'::public.payment_status
      and reversed_at is null
      and reversed_by is null
      and reversal_reason is null
    )
    or (
      status = 'reversed'::public.payment_status
      and reversed_at is not null
      and reversed_by is not null
      and nullif(btrim(reversal_reason), '') is not null
    )
  );

create or replace function private.payment_mutation_write_context_enabled()
returns boolean
language sql
stable
set search_path = ''
as $$
  select private.record_payment_write_context_enabled()
    or coalesce(current_setting('app.reverse_payment_write_context', true), 'off') = 'on';
$$;

revoke execute on function private.payment_mutation_write_context_enabled() from public;
grant execute on function private.payment_mutation_write_context_enabled() to authenticated;

comment on function private.payment_mutation_write_context_enabled() is
'Marca efimera compartida por mutaciones financieras criticas. Hoy habilita record_payment y reverse_payment sin abrir UPDATE/INSERT directo equivalente por Data API.';

drop policy if exists "loans_update_via_record_payment_context" on public.loans;
drop policy if exists "loans_update_via_payment_mutation_context" on public.loans;
create policy "loans_update_via_payment_mutation_context"
on public.loans
for update
to authenticated
using (
  private.payment_mutation_write_context_enabled()
  and private.can_access_collector(collector_id)
)
with check (
  private.payment_mutation_write_context_enabled()
  and private.can_access_collector(collector_id)
);

drop policy if exists "installments_update_via_record_payment_context" on public.installments;
drop policy if exists "installments_update_via_payment_mutation_context" on public.installments;
create policy "installments_update_via_payment_mutation_context"
on public.installments
for update
to authenticated
using (
  private.payment_mutation_write_context_enabled()
  and exists (
    select 1
    from public.loans
    where public.loans.id = installments.loan_id
      and private.can_access_collector(public.loans.collector_id)
  )
)
with check (
  private.payment_mutation_write_context_enabled()
  and exists (
    select 1
    from public.loans
    where public.loans.id = installments.loan_id
      and private.can_access_collector(public.loans.collector_id)
  )
);

drop policy if exists "payment_events_insert_via_record_payment_context" on public.payment_events;
drop policy if exists "payment_events_insert_via_payment_mutation_context" on public.payment_events;
create policy "payment_events_insert_via_payment_mutation_context"
on public.payment_events
for insert
to authenticated
with check (
  private.payment_mutation_write_context_enabled()
  and exists (
    select 1
    from public.payments
    where public.payments.id = payment_events.payment_id
      and private.can_access_collector(public.payments.collector_id)
  )
);

drop policy if exists "payments_update_via_payment_mutation_context" on public.payments;
create policy "payments_update_via_payment_mutation_context"
on public.payments
for update
to authenticated
using (
  private.payment_mutation_write_context_enabled()
  and private.can_access_collector(collector_id)
)
with check (
  private.payment_mutation_write_context_enabled()
  and private.can_access_collector(collector_id)
);

grant update on table public.payments to authenticated;

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

revoke execute on function public.get_payment_receipt(uuid) from public;
grant execute on function public.get_payment_receipt(uuid) to authenticated;

comment on function public.get_payment_receipt(uuid) is
'Recibo autoritativo de BR-3 y BR-5. Lee el pago confirmado o reversado bajo RLS del actor autenticado y devuelve el desglose materializado por cuota mas la trazabilidad del reverso cuando existe.';

create or replace function public.reverse_payment(
  p_payment_id uuid,
  p_reversal_reason text
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_business_date date := timezone('America/Bogota', now())::date;
  v_normalized_reason text := nullif(btrim(p_reversal_reason), '');
  v_payment public.payments%rowtype;
  v_loan public.loans%rowtype;
  v_installment public.installments%rowtype;
  v_restored_outstanding numeric(14, 2);
  v_reversed_at timestamptz := timezone('utc', now());
  v_application record;
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if not private.current_profile_is_active() then
    raise exception 'operator_inactive';
  end if;

  if not private.is_admin() then
    raise exception 'reverse_role_not_allowed';
  end if;

  if p_payment_id is null then
    raise exception 'payment_id_required';
  end if;

  -- Igual que record_payment, el contexto debe existir antes del primer FOR UPDATE
  -- para no volver invisible la fila bajo las policies de mutacion financiera.
  perform set_config('app.reverse_payment_write_context', 'on', true);

  select *
  into v_payment
  from public.payments
  where public.payments.id = p_payment_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  if v_payment.status = 'reversed'::public.payment_status then
    perform set_config('app.reverse_payment_write_context', 'off', true);
    return public.get_payment_receipt(v_payment.id);
  end if;

  if v_normalized_reason is null then
    raise exception 'reversal_reason_required';
  end if;

  select *
  into v_loan
  from public.loans
  where public.loans.id = v_payment.loan_id
  for update;

  if not found then
    raise exception 'loan_not_found';
  end if;

  if v_loan.status in ('draft'::public.loan_status, 'written_off'::public.loan_status, 'canceled'::public.loan_status) then
    raise exception 'loan_status_not_reversible';
  end if;

  if not exists (
    select 1
    from public.payment_applications
    where public.payment_applications.payment_id = v_payment.id
  ) then
    raise exception 'payment_without_applications';
  end if;

  for v_application in
    select
      public.payment_applications.installment_id,
      public.payment_applications.applied_amount
    from public.payment_applications
    inner join public.installments
      on public.installments.id = public.payment_applications.installment_id
    where public.payment_applications.payment_id = v_payment.id
    order by public.installments.due_date asc, public.installments.installment_number asc, public.installments.id asc
  loop
    select *
    into v_installment
    from public.installments
    where public.installments.id = v_application.installment_id
      and public.installments.loan_id = v_payment.loan_id
    for update;

    if not found then
      raise exception 'installment_not_found_for_payment';
    end if;

    if v_installment.status = 'canceled'::public.installment_status then
      raise exception 'installment_not_reversible';
    end if;

    v_restored_outstanding := v_installment.outstanding_amount + v_application.applied_amount;

    if v_restored_outstanding < 0 or v_restored_outstanding > v_installment.scheduled_amount then
      raise exception 'reversal_exceeds_scheduled_amount';
    end if;

    update public.installments
    set
      outstanding_amount = v_restored_outstanding,
      status = case
        when v_restored_outstanding = 0 then 'paid'::public.installment_status
        when due_date < v_business_date then 'overdue'::public.installment_status
        when v_restored_outstanding < scheduled_amount then 'partial'::public.installment_status
        else 'pending'::public.installment_status
      end
    where id = v_installment.id;
  end loop;

  update public.loans
  set status = case
    when status in ('written_off'::public.loan_status, 'canceled'::public.loan_status) then status
    when not exists (
      select 1
      from public.installments
      where public.installments.loan_id = v_payment.loan_id
        and public.installments.outstanding_amount > 0
    ) then 'settled'::public.loan_status
    when exists (
      select 1
      from public.installments
      where public.installments.loan_id = v_payment.loan_id
        and public.installments.outstanding_amount > 0
        and public.installments.due_date < v_business_date
    ) then 'delinquent'::public.loan_status
    else 'active'::public.loan_status
  end
  where id = v_payment.loan_id;

  update public.payments
  set
    status = 'reversed'::public.payment_status,
    reversed_at = v_reversed_at,
    reversed_by = v_actor_id,
    reversal_reason = v_normalized_reason
  where public.payments.id = v_payment.id;

  insert into public.payment_events (
    payment_id,
    actor_id,
    event_name,
    payload
  )
  values (
    v_payment.id,
    v_actor_id,
    'payment_reversed',
    jsonb_build_object(
      'reversed_at', v_reversed_at,
      'reversal_reason', v_normalized_reason,
      'business_date', v_business_date,
      'business_timezone', 'America/Bogota',
      'original_collector_id', v_payment.collector_id,
      'original_paid_at', v_payment.paid_at,
      'total_amount', v_payment.total_amount::text
    )
  );

  perform set_config('app.reverse_payment_write_context', 'off', true);
  return public.get_payment_receipt(v_payment.id);
exception
  when others then
    perform set_config('app.reverse_payment_write_context', 'off', true);
    raise;
end;
$$;

revoke execute on function public.reverse_payment(uuid, text) from public;
grant execute on function public.reverse_payment(uuid, text) to authenticated;

comment on function public.reverse_payment(uuid, text) is
'RPC BR-5 online-only para admin activo. Revierte un pago confirmado, restaura saldos de cuotas y del prestamo en la misma transaccion, marca payments.status = reversed y registra un evento compensatorio sin borrar historial.';
