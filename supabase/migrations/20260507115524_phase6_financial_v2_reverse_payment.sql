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
  v_normalized_reason text := nullif(trim(p_reversal_reason), '');
  v_payment public.payments%rowtype;
  v_loan public.loans%rowtype;
  v_installment public.installments%rowtype;
  v_application record;
  v_business_date date := timezone('America/Bogota', timezone('utc', now()))::date;
  v_reversed_at timestamptz := timezone('utc', now());
  v_restored_outstanding numeric(14, 2);
  v_restored_outstanding_principal numeric(14, 2);
  v_restored_outstanding_interest numeric(14, 2);
  v_restored_outstanding_fee numeric(14, 2);
begin
  if v_actor_id is null then
    raise exception 'authentication_required';
  end if;

  if not private.current_profile_is_active() then
    raise exception 'reversal_actor_inactive';
  end if;

  if not private.is_admin() then
    raise exception 'reversal_actor_role_not_allowed';
  end if;

  perform set_config('app.record_payment_write_context', 'on', true);

  select *
  into v_payment
  from public.payments
  where public.payments.id = p_payment_id
  for update;

  if not found then
    raise exception 'payment_not_found';
  end if;

  if v_payment.status = 'reversed'::public.payment_status then
    perform set_config('app.record_payment_write_context', 'off', true);
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
      public.payment_applications.applied_amount,
      public.payment_applications.principal_component,
      public.payment_applications.interest_component,
      public.payment_applications.fee_component
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

    v_restored_outstanding_principal := v_installment.outstanding_principal_amount + v_application.principal_component;
    v_restored_outstanding_interest := v_installment.outstanding_interest_amount + v_application.interest_component;
    v_restored_outstanding_fee := v_installment.outstanding_fee_amount + v_application.fee_component;
    v_restored_outstanding :=
      v_restored_outstanding_principal + v_restored_outstanding_interest + v_restored_outstanding_fee;

    if v_restored_outstanding < 0 or v_restored_outstanding > v_installment.scheduled_amount then
      raise exception 'reversal_exceeds_scheduled_amount';
    end if;

    if v_restored_outstanding_principal < 0
      or v_restored_outstanding_principal > v_installment.principal_amount
      or v_restored_outstanding_interest < 0
      or v_restored_outstanding_interest > v_installment.interest_amount
      or v_restored_outstanding_fee < 0
      or v_restored_outstanding_fee > v_installment.fee_amount then
      raise exception 'reversal_component_balance_invalid';
    end if;

    update public.installments
    set
      outstanding_principal_amount = v_restored_outstanding_principal,
      outstanding_interest_amount = v_restored_outstanding_interest,
      outstanding_fee_amount = v_restored_outstanding_fee,
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
  where id = v_payment.id;

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
      'interest_mode', v_loan.interest_mode::text,
      'payment_application_mode', v_loan.payment_application_mode::text
    )
  );

  perform set_config('app.record_payment_write_context', 'off', true);
  return public.get_payment_receipt(v_payment.id);
exception
  when others then
    perform set_config('app.record_payment_write_context', 'off', true);
    raise;
end;
$$;

comment on function public.reverse_payment(uuid, text) is
'RPC BR-5/BR-6 online-only para admin activo. Revierte un pago confirmado restaurando outstanding_amount y cada saldo por componente en la misma transaccion.';
