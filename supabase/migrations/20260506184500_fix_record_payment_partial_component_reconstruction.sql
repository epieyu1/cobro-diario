-- Corrige un hueco del contrato V1 al validar cuotas parcialmente pagadas.
-- record_payment() no puede depender solo de payment_applications historicas para
-- reconstruir fee/interes/capital pendientes porque LANDING y futuros bootstrap remotos
-- pueden materializar outstanding_amount valido sin traer todo el historico transaccional.
-- Fuente de verdad: el saldo pendiente actual de la cuota mas el orden contractual
-- fee -> interest -> principal definido en docs/financial-contract-v1.md.

create or replace function public.record_payment(
  p_device_local_id text,
  p_payment_reference text,
  p_collector_id uuid,
  p_customer_id uuid,
  p_loan_id uuid,
  p_device_id uuid,
  p_payment_method text,
  p_paid_at timestamptz,
  p_latitude numeric,
  p_longitude numeric,
  p_notes text,
  p_applications jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_payment_id uuid;
  v_inserted_payment_id uuid;
  v_total_amount numeric(14, 2);
  v_application jsonb;
  v_application_installment_id uuid;
  v_loan public.loans%rowtype;
  v_installment public.installments%rowtype;
  v_expected_installment_id uuid;
  v_existing_payment public.payments%rowtype;
  v_device public.devices%rowtype;
  v_applied_amount numeric(14, 2);
  v_principal_component numeric(14, 2);
  v_interest_component numeric(14, 2);
  v_fee_component numeric(14, 2);
  v_component_total numeric(14, 2);
  v_remaining_amount numeric(14, 2);
  v_business_date date := timezone('America/Bogota', p_paid_at)::date;
  v_paid_amount numeric(14, 2);
  v_remaining_principal_component numeric(14, 2);
  v_remaining_interest_component numeric(14, 2);
  v_remaining_fee_component numeric(14, 2);
  v_installment_component_outstanding numeric(14, 2);
  v_expected_fee_component numeric(14, 2);
  v_expected_interest_component numeric(14, 2);
  v_expected_principal_component numeric(14, 2);
  v_remaining_to_allocate numeric(14, 2);
begin
  if nullif(trim(p_device_local_id), '') is null then
    raise exception 'device_local_id_required';
  end if;

  if p_paid_at is null then
    raise exception 'paid_at_required';
  end if;

  if not private.can_access_collector(p_collector_id) then
    raise exception 'collector_not_allowed';
  end if;

  -- La trazabilidad del dispositivo solo es confiable si el UUID pertenece al mismo cobrador.
  if p_device_id is not null then
    select *
    into v_device
    from public.devices
    where public.devices.id = p_device_id;

    if not found or v_device.collector_id <> p_collector_id then
      raise exception 'device_not_owned_by_collector';
    end if;
  end if;

  select *
  into v_existing_payment
  from public.payments
  where public.payments.device_local_id = p_device_local_id;

  if found then
    if v_existing_payment.loan_id = p_loan_id
      and v_existing_payment.customer_id = p_customer_id
      and v_existing_payment.collector_id = p_collector_id then
      return v_existing_payment.id;
    end if;

    raise exception 'device_local_id_conflict';
  end if;

  if jsonb_typeof(p_applications) <> 'array' or jsonb_array_length(p_applications) = 0 then
    raise exception 'payment_requires_applications';
  end if;

  if exists (
    select 1
    from (
      select application ->> 'installment_id' as installment_id
      from jsonb_array_elements(p_applications) as application
      group by application ->> 'installment_id'
      having count(*) > 1
    ) as duplicated_installments
  ) then
    raise exception 'duplicate_installment_application';
  end if;

  select coalesce(sum((application ->> 'applied_amount')::numeric(14, 2)), 0)
  into v_total_amount
  from jsonb_array_elements(p_applications) as application;

  if v_total_amount <= 0 then
    raise exception 'payment_total_must_be_positive';
  end if;

  -- El contexto debe abrirse antes del primer FOR UPDATE; de lo contrario,
  -- las policies de update dejan invisible la fila bloqueada bajo RLS endurecido.
  perform set_config('app.record_payment_write_context', 'on', true);

  select *
  into v_loan
  from public.loans
  where public.loans.id = p_loan_id
  for update;

  if not found then
    raise exception 'loan_not_found';
  end if;

  if v_loan.customer_id <> p_customer_id then
    raise exception 'loan_customer_mismatch';
  end if;

  if v_loan.collector_id <> p_collector_id then
    raise exception 'loan_collector_mismatch';
  end if;

  if v_loan.status not in ('active'::public.loan_status, 'delinquent'::public.loan_status) then
    raise exception 'loan_status_not_payable';
  end if;

  insert into public.payments (
    id,
    customer_id,
    loan_id,
    collector_id,
    device_id,
    device_local_id,
    payment_reference,
    payment_method,
    total_amount,
    latitude,
    longitude,
    notes,
    paid_at
  )
  values (
    extensions.gen_random_uuid(),
    p_customer_id,
    p_loan_id,
    p_collector_id,
    p_device_id,
    p_device_local_id,
    p_payment_reference,
    coalesce(nullif(trim(p_payment_method), ''), 'cash'),
    v_total_amount,
    p_latitude,
    p_longitude,
    p_notes,
    p_paid_at
  )
  on conflict (device_local_id) do nothing
  returning id into v_inserted_payment_id;

  if v_inserted_payment_id is null then
    select *
    into v_existing_payment
    from public.payments
    where public.payments.device_local_id = p_device_local_id;

    if found
      and v_existing_payment.loan_id = p_loan_id
      and v_existing_payment.customer_id = p_customer_id
      and v_existing_payment.collector_id = p_collector_id then
      perform set_config('app.record_payment_write_context', 'off', true);
      return v_existing_payment.id;
    end if;

    raise exception 'device_local_id_conflict';
  end if;

  v_payment_id := v_inserted_payment_id;

  for v_application in
    select value from jsonb_array_elements(p_applications)
  loop
    if jsonb_typeof(v_application) <> 'object' then
      raise exception 'invalid_payment_application';
    end if;

    if nullif(v_application ->> 'installment_id', '') is null then
      raise exception 'installment_id_required';
    end if;

    v_application_installment_id := (v_application ->> 'installment_id')::uuid;

    select public.installments.id
    into v_expected_installment_id
    from public.installments
    where public.installments.loan_id = p_loan_id
      and public.installments.outstanding_amount > 0
      and public.installments.status not in ('paid'::public.installment_status, 'canceled'::public.installment_status)
    order by public.installments.due_date asc, public.installments.installment_number asc, public.installments.id asc
    limit 1
    for update;

    if not found then
      raise exception 'loan_without_payable_installments';
    end if;

    if v_expected_installment_id <> v_application_installment_id then
      raise exception 'installment_order_violation';
    end if;

    select *
    into v_installment
    from public.installments
    where public.installments.id = v_application_installment_id
      and public.installments.loan_id = p_loan_id
    for update;

    if not found then
      raise exception 'installment_not_found_for_loan';
    end if;

    if v_installment.status in ('paid'::public.installment_status, 'canceled'::public.installment_status) then
      raise exception 'installment_not_payable';
    end if;

    if v_installment.outstanding_amount < 0
      or v_installment.outstanding_amount > v_installment.scheduled_amount then
      raise exception 'installment_component_balance_invalid';
    end if;

    -- V1 siempre consume fee -> interest -> principal. Por eso el saldo pendiente
    -- por componente puede reconstruirse desde outstanding_amount aunque no exista
    -- un historico completo de payment_applications para esta cuota.
    v_paid_amount := v_installment.scheduled_amount - v_installment.outstanding_amount;
    v_remaining_fee_component :=
      v_installment.fee_amount - least(v_paid_amount, v_installment.fee_amount);
    v_remaining_interest_component :=
      v_installment.interest_amount - least(greatest(v_paid_amount - v_installment.fee_amount, 0), v_installment.interest_amount);
    v_remaining_principal_component :=
      v_installment.principal_amount - least(
        greatest(v_paid_amount - v_installment.fee_amount - v_installment.interest_amount, 0),
        v_installment.principal_amount
      );
    v_installment_component_outstanding :=
      v_remaining_principal_component + v_remaining_interest_component + v_remaining_fee_component;

    if v_remaining_principal_component < 0
      or v_remaining_interest_component < 0
      or v_remaining_fee_component < 0 then
      raise exception 'installment_component_balance_invalid';
    end if;

    if v_installment_component_outstanding <> v_installment.outstanding_amount then
      raise exception 'installment_component_balance_mismatch';
    end if;

    v_applied_amount := coalesce((v_application ->> 'applied_amount')::numeric(14, 2), 0);
    v_principal_component := coalesce((v_application ->> 'principal_component')::numeric(14, 2), 0);
    v_interest_component := coalesce((v_application ->> 'interest_component')::numeric(14, 2), 0);
    v_fee_component := coalesce((v_application ->> 'fee_component')::numeric(14, 2), 0);

    if v_applied_amount <= 0 then
      raise exception 'invalid_applied_amount';
    end if;

    if v_principal_component < 0 or v_interest_component < 0 or v_fee_component < 0 then
      raise exception 'negative_component_not_allowed';
    end if;

    v_component_total := v_principal_component + v_interest_component + v_fee_component;

    if v_component_total <> v_applied_amount then
      raise exception 'application_components_mismatch';
    end if;

    v_remaining_to_allocate := v_applied_amount;
    v_expected_fee_component := least(v_remaining_to_allocate, v_remaining_fee_component);
    v_remaining_to_allocate := v_remaining_to_allocate - v_expected_fee_component;
    v_expected_interest_component := least(v_remaining_to_allocate, v_remaining_interest_component);
    v_remaining_to_allocate := v_remaining_to_allocate - v_expected_interest_component;
    v_expected_principal_component := least(v_remaining_to_allocate, v_remaining_principal_component);
    v_remaining_to_allocate := v_remaining_to_allocate - v_expected_principal_component;

    if v_remaining_to_allocate <> 0 then
      raise exception 'application_exceeds_component_balance';
    end if;

    if v_fee_component <> v_expected_fee_component
      or v_interest_component <> v_expected_interest_component
      or v_principal_component <> v_expected_principal_component then
      raise exception 'application_order_violation';
    end if;

    if v_applied_amount > v_installment.outstanding_amount then
      raise exception 'applied_amount_exceeds_outstanding';
    end if;

    insert into public.payment_applications (
      payment_id,
      installment_id,
      applied_amount,
      principal_component,
      interest_component,
      fee_component
    )
    values (
      v_payment_id,
      v_installment.id,
      v_applied_amount,
      v_principal_component,
      v_interest_component,
      v_fee_component
    );

    v_remaining_amount := v_installment.outstanding_amount - v_applied_amount;

    update public.installments
    set
      outstanding_amount = v_remaining_amount,
      status = case
        when v_remaining_amount = 0 then 'paid'::public.installment_status
        when due_date < v_business_date then 'overdue'::public.installment_status
        when v_remaining_amount < scheduled_amount then 'partial'::public.installment_status
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
      where public.installments.loan_id = p_loan_id
        and public.installments.outstanding_amount > 0
    ) then 'settled'::public.loan_status
    when exists (
      select 1
      from public.installments
      where public.installments.loan_id = p_loan_id
        and public.installments.outstanding_amount > 0
        and public.installments.due_date < v_business_date
    ) then 'delinquent'::public.loan_status
    else 'active'::public.loan_status
  end
  where id = p_loan_id;

  insert into public.payment_events (
    payment_id,
    actor_id,
    event_name,
    payload
  )
  values (
    v_payment_id,
    p_collector_id,
    'payment_recorded',
    jsonb_build_object(
      'device_local_id', p_device_local_id,
      'application_count', jsonb_array_length(p_applications),
      'derived_total_amount', v_total_amount,
      'business_date', v_business_date,
      'business_timezone', 'America/Bogota'
    )
  );

  perform set_config('app.record_payment_write_context', 'off', true);
  return v_payment_id;
exception
  when others then
    perform set_config('app.record_payment_write_context', 'off', true);
    raise;
end;
$$;

comment on function public.record_payment(
  text,
  text,
  uuid,
  uuid,
  uuid,
  uuid,
  text,
  timestamptz,
  numeric,
  numeric,
  text,
  jsonb
) is
'RPC V1 atomico e idempotente por device_local_id. Reconstruye fee/interes/capital pendientes desde outstanding_amount y el orden fee -> interest -> principal para no depender de historicos completos de payment_applications en cuotas parciales.';
